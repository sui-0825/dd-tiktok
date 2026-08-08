/* D&D❀TikTok Ver26.00 / storage schema 26 - IndexedDB safety layer
   Existing synchronous localStorage behavior is preserved while a complete,
   asynchronous IndexedDB copy is maintained for recovery and future migration.
*/
(() => {
  'use strict';
  const DB_NAME = 'dd_tiktok_longterm_v26';
  const DB_VERSION = 1;
  const STORE = 'snapshots';
  const LIVE_KEY = 'live';
  const META_KEY = 'dd_idb_v26_status';
  let idb = null;
  let writeTimer = 0;
  let writeInFlight = Promise.resolve();

  function openDB() {
    if (idb) return Promise.resolve(idb);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      };
      req.onsuccess = () => { idb = req.result; resolve(idb); };
      req.onerror = () => reject(req.error || new Error('IndexedDBを開けませんでした'));
    });
  }

  async function putSnapshot(payload) {
    const database = await openDB();
    await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(payload, LIVE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('IndexedDB保存に失敗しました'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB保存が中断されました'));
    });
    try {
      localStorage.setItem(META_KEY, JSON.stringify({ savedAt: Date.now(), entries: payload?.data?.entries?.length || 0 }));
    } catch (_) {}
  }

  async function getSnapshot() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(LIVE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('IndexedDB読込に失敗しました'));
    });
  }

  function buildPayload() {
    const source = (typeof compactDBForStorage === 'function') ? compactDBForStorage(db) : db;
    // Ver25.98: iPhoneでlocalStorageが容量上限でも、差分カーソルは
    // DDCloudのメモリ上の最新値からIndexedDBへ直接保存する。
    let entryCursor=String(window.DDCloud?.state?.entryCursor||''), metaCursor=String(window.DDCloud?.state?.metaCursor||''), historyRepairV2600=Boolean(window.DDCloud?.state?.historyRepairComplete);
    try {
      if (!entryCursor) entryCursor = localStorage.getItem('dd_entry_records_cursor_v2') || '';
      if (!metaCursor) metaCursor = localStorage.getItem('dd_meta_cursor_v1') || '';
      if (!historyRepairV2600) historyRepairV2600 = localStorage.getItem('dd_entry_history_repair_v2600') === 'complete';
    } catch (_) {}
    return {
      format: 'D&D_TIKTOK_IDB_SNAPSHOT',
      schemaVersion: 26,
      savedAt: new Date().toISOString(),
      sync: { entryCursor, metaCursor, historyRepairV2600 },
      data: JSON.parse(JSON.stringify(source))
    };
  }

  function queueMirror(delay = 120) {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      let payload;
      try { payload = buildPayload(); } catch (e) { console.warn('IndexedDB snapshot build failed', e); return; }
      writeInFlight = writeInFlight
        .catch(() => {})
        .then(() => putSnapshot(payload))
        .then(() => window.dispatchEvent(new CustomEvent('dd-storage-status', { detail: { mode: 'idb', status: '長期保存済み' } })))
        .catch(e => {
          console.warn('IndexedDB mirror failed', e);
          window.dispatchEvent(new CustomEvent('dd-storage-status', { detail: { mode: 'error', status: '長期保存エラー', error: String(e?.message || e) } }));
        });
    }, delay);
  }

  // Keep all existing behavior, then create the durable mirror.
  const originalPersist = window.persist;
  if (typeof originalPersist === 'function') {
    window.persist = function persistV26() {
      const result = originalPersist.apply(this, arguments);
      queueMirror();
      return result;
    };
    // Global function bindings created with function declarations may not follow
    // window assignment in every engine, so rebind explicitly.
    try { persist = window.persist; } catch (_) {}
  }

  async function recoverIfNeeded() {
    const hasLocalData = Array.isArray(window.db?.devices) && (db.devices.length > 0 || db.entries.length > 0);
    try {
      const snapshot = await getSnapshot();
      const restored = snapshot?.data;
      if (!restored || !Array.isArray(restored.devices) || !Array.isArray(restored.entries)) {
        if (hasLocalData) queueMirror(20);
        return false;
      }
      let localSavedAt = 0;
      try { localSavedAt = Number(localStorage.getItem('dd_last_local_save_v25') || 0); } catch (_) {}
      const idbSavedAt = Date.parse(snapshot?.savedAt || '') || 0;
      // Ver25.97: localStorageが残っていても、容量超過前にIndexedDBへ保存した方が新しければそちらを採用。
      if (hasLocalData && localSavedAt >= idbSavedAt) { queueMirror(20); return false; }
      db = restored;
      db.invites = Array.isArray(db.invites) ? db.invites : [];
      db.bulletins = Array.isArray(db.bulletins) ? db.bulletins : [];
      db.members = Array.isArray(db.members) ? db.members : [];
      db.finance = db.finance || { monthly: {}, targets: {}, initialInvestment: 0 };
      db.security = db.security || {};
      try {
        if (snapshot?.sync?.entryCursor) localStorage.setItem('dd_entry_records_cursor_v2', snapshot.sync.entryCursor);
        if (snapshot?.sync?.metaCursor) localStorage.setItem('dd_meta_cursor_v1', snapshot.sync.metaCursor);
      } catch (_) {}
      if (typeof recalculateStoredEntries === 'function') recalculateStoredEntries(db);
      originalPersist?.call(window);
      ['renderHome','renderDevices','renderAnnual','renderReport','renderInputMembers'].forEach(name => {
        try { if (typeof window[name] === 'function') window[name](); } catch (_) {}
      });
      document.getElementById('firstLoginOverlay')?.classList.remove('show');
      if (typeof toast === 'function') toast('長期保存データから復元しました');
      return true;
    } catch (e) {
      console.warn('IndexedDB recovery skipped', e);
      return false;
    }
  }

  window.DDLongTermStorage = {
    version: 26,
    saveNow: () => {
      // Ver25.98: 差分カーソル更新直後はsetTimeout待ちにせず、すぐIndexedDBへ確定する。
      let payload;
      try { payload = buildPayload(); } catch (e) { return Promise.reject(e); }
      writeInFlight = writeInFlight.catch(() => {}).then(() => putSnapshot(payload));
      return writeInFlight;
    },
    getSnapshot,
    getSyncCursors: async () => {
      const snap = await getSnapshot().catch(() => null);
      return {
        entryCursor: String(snap?.sync?.entryCursor || ''),
        metaCursor: String(snap?.sync?.metaCursor || ''),
        historyRepairV2600: Boolean(snap?.sync?.historyRepairV2600),
        savedAt: String(snap?.savedAt || '')
      };
    },
    recoverIfNeeded,
    diagnostics: async () => {
      const snap = await getSnapshot().catch(() => null);
      return {
        available: !!window.indexedDB,
        savedAt: snap?.savedAt || '',
        devices: snap?.data?.devices?.length || 0,
        entries: snap?.data?.entries?.length || 0
      };
    }
  };

  // Ver25.98: 初回復元の完了をクラウド側が待てるようready Promiseを公開する。
  // これによりiPhone起動時に「復元」と「差分受信」が競争しない。
  window.DDLongTermStorage.ready = recoverIfNeeded().catch(e => {
    console.warn('IndexedDB initial recovery failed', e);
    return false;
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') queueMirror(0); });
  window.addEventListener('pagehide', () => queueMirror(0));
})();
