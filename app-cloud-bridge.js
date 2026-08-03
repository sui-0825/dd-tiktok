/* D&D❀TikTok Ver25.61 restore lock and exact backup commit */
(()=>{
'use strict';
const cfg=window.DD_BACKEND_CONFIG||{};
const TOKEN_KEY='dd_supabase_anon_session_v2', LOCAL_USER_KEY='dd_tiktok_local_user_v1', DEVICE_ID_KEY='dd_device_registration_id_v1', DEVICE_ACCOUNT_KEY='dd_device_bound_user_v1', OWNER_UNLOCK_KEY='dd_owner_emergency_unlock_v1', OWNER_FAIL_KEY='dd_owner_pin_fail_v1', DIRTY_KEY='dd_cloud_dirty_v25', DIRTY_SEQ_KEY='dd_cloud_dirty_seq_v25';
const diag=[];
const ENTRY_CURSOR_KEY='dd_entry_records_cursor_v2';
function addDiag(step,detail=''){const row={time:new Date().toISOString(),step:String(step),detail:String(detail||'')};diag.push(row);if(diag.length>30)diag.shift();console.log('[DD DIAG]',row);return row}
const state={entryCursor:'',mode:'local',status:'起動中…',stage:'boot',user:null,accessToken:'',workspaceId:'',revision:0,syncTimer:null,retryTimer:null,presenceTimer:null,profileTimer:null,accessTimer:null,receiveTimer:null,receiveBusy:false,applying:false,lastError:'',role:'',accessStatus:'unknown',profiles:[],recoveryProtected:true,dirty:false,dirtySeq:0,pushingSeq:0};
const publicState=()=>({...state,syncTimer:undefined,retryTimer:undefined,presenceTimer:undefined,profileTimer:undefined,accessTimer:undefined,accessToken:undefined,user:state.user?{id:state.user.id}:null});

function loadDirtyState(){try{state.dirty=localStorage.getItem(DIRTY_KEY)==='1';state.dirtySeq=Number(localStorage.getItem(DIRTY_SEQ_KEY)||0)}catch(_){state.dirty=false;state.dirtySeq=0}}
function markDirty(){state.dirty=true;state.dirtySeq=Math.max(Date.now(),state.dirtySeq+1);try{localStorage.setItem(DIRTY_KEY,'1');localStorage.setItem(DIRTY_SEQ_KEY,String(state.dirtySeq))}catch(_){}}
function clearDirty(seq){if(state.dirtySeq!==seq)return;state.dirty=false;try{localStorage.removeItem(DIRTY_KEY)}catch(_){}}
function scheduleRetry(){clearTimeout(state.retryTimer);state.retryTimer=setTimeout(()=>{if(state.dirty&&navigator.onLine!==false)push().catch(()=>scheduleRetry())},5000)}
loadDirtyState();

const emit=()=>window.dispatchEvent(new CustomEvent('dd-cloud-status',{detail:publicState()}));
const emitAccess=()=>window.dispatchEvent(new CustomEvent('dd-access-state',{detail:publicState()}));
function setStatus(status,mode=state.mode,error='',stage=state.stage){state.status=status;state.mode=mode;state.lastError=error||'';state.stage=stage||'';document.documentElement.dataset.storageMode=mode;document.documentElement.dataset.cloudStage=state.stage;emit()}
const configured=()=>Boolean(cfg.enabled&&cfg.provider==='supabase'&&cfg.url&&cfg.anonKey&&cfg.workspaceId);
const base=String(cfg.url||'').replace(/\/+$/,''), api=p=>`${base}${p}`;
const authHeaders=()=>({apikey:cfg.anonKey,Authorization:`Bearer ${state.accessToken}`,'Content-Type':'application/json'});
const getLocalUserName=()=>{try{return String(localStorage.getItem(LOCAL_USER_KEY)||'').trim()}catch(_){return ''}};

function getDeviceRegistrationId(){
 try{
  let id=String(localStorage.getItem(DEVICE_ID_KEY)||'').trim();
  if(!id){id=(crypto.randomUUID?crypto.randomUUID():`dd-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);localStorage.setItem(DEVICE_ID_KEY,id)}
  return id;
 }catch(_){return `dd-${Date.now()}-${Math.random().toString(36).slice(2)}`}
}
function rememberDeviceAccount(){try{if(state.user?.id)localStorage.setItem(DEVICE_ACCOUNT_KEY,state.user.id)}catch(_){}}

function hasMeaningfulLocalData(){const d=window.db;return Boolean(d&&typeof d==='object'&&((Array.isArray(d.devices)&&d.devices.length>0)||(Array.isArray(d.entries)&&d.entries.length>0)||(Array.isArray(d.invites)&&d.invites.length>0)));}

function stableComparable(value){
 if(Array.isArray(value))return value.map(stableComparable);
 if(value&&typeof value==='object'){
  const out={};
  for(const key of Object.keys(value).sort()){
   if(['currentUser','members','lastSeenAt','last_seen_at'].includes(key))continue;
   out[key]=stableComparable(value[key]);
  }
  return out;
 }
 return value;
}
function recordSignature(row){try{return JSON.stringify(stableComparable(row))}catch(_){return ''}}
function inspectActualUnsyncedChanges(remote={},local={}){
 const details=[];
 const groups=['devices','entries','invites','bulletins'];
 for(const key of groups){
  const rmap=new Map((Array.isArray(remote[key])?remote[key]:[]).filter(Boolean).map(x=>[String(x.id||''),x]));
  for(const row of (Array.isArray(local[key])?local[key]:[])){
   const id=String(row?.id||'');
   if(!id){details.push(`${key}:idなし`);continue}
   if(!rmap.has(id)){details.push(`${key}:クラウド未登録 ${id}`);continue}
   const rr=rmap.get(id);
   const lc=recordClock(row),rc=recordClock(rr);
   // 同じIDの差分は、端末側の更新時刻が明確に新しい場合だけ未送信と判定する。
   // 再計算や表示用フィールドの差だけで、永久にdirty扱いになるのを防ぐ。
   if(lc>rc&&recordSignature(row)!==recordSignature(rr))details.push(`${key}:端末側が新しい ${id}`);
  }
 }
 return {unsynced:details.length>0,details};
}
function hasActualUnsyncedChanges(remote={},local={}){return inspectActualUnsyncedChanges(remote,local).unsynced}
async function reconcileDirtyStateWithRemote(){
 if(!state.dirty||!state.workspaceId||state.accessStatus!=='approved')return {cleared:false};
 const rows=await rest(`app_snapshots?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=revision,payload,updated_at&limit=1`,{timeoutMs:45000});
 const row=Array.isArray(rows)?rows[0]:null;
 if(!row?.payload||typeof row.payload!=='object')return {cleared:false};
 const check=inspectActualUnsyncedChanges(row.payload,window.db||{});
 if(check.unsynced){addDiag('DIRTY_REAL_QUEUE',check.details.slice(0,8).join(' / '));return {cleared:false,unsynced:true,details:check.details,revision:Number(row.revision||0)}};
 state.dirty=false;state.dirtySeq=0;state.revision=Number(row.revision||0);
 try{localStorage.removeItem(DIRTY_KEY);localStorage.removeItem(DIRTY_SEQ_KEY)}catch(_){}
 addDiag('DIRTY_REPAIRED',`revision=${state.revision}`);
 return {cleared:true,revision:state.revision,payload:row.payload};
}
function recordClock(x){return Math.max(Number(x?.editedAt||0),Number(x?.updatedAt||0),Number(x?.timestamp||0),Number(x?.createdAt||0))}
function mergeRecordArrays(remote=[],local=[]){
 const map=new Map();
 for(const row of [...remote,...local]){
  if(!row||typeof row!=='object')continue;
  const id=String(row.id||'');
  if(!id){continue}
  const prev=map.get(id);
  if(!prev||recordClock(row)>recordClock(prev))map.set(id,row);
 }
 return [...map.values()];
}
function mergeSnapshots(remote={},local={}){
 const out={...remote,...local};
 out.devices=mergeRecordArrays(remote.devices,local.devices);
 out.entries=mergeRecordArrays(remote.entries,local.entries);
 out.invites=mergeRecordArrays(remote.invites,local.invites);
 out.bulletins=mergeRecordArrays(remote.bulletins,local.bulletins);
 out.members=[...new Set([...(remote.members||[]),...(local.members||[])].map(v=>String(v||'').trim()).filter(Boolean))];
 out.finance={...(remote.finance||{}),...(local.finance||{}),monthly:{...(remote.finance?.monthly||{}),...(local.finance?.monthly||{})},targets:{...(remote.finance?.targets||{}),...(local.finance?.targets||{})}};
 out.security={...(remote.security||{}),...(local.security||{})};
 out.currentUser=String(local.currentUser||'');
 return out;
}
async function jsonFetch(url,options={}){
 const controller=new AbortController();
 const timeoutMs=Number(options.timeoutMs||45000);
 const timer=setTimeout(()=>controller.abort(new DOMException('通信が45秒を超えました','AbortError')),timeoutMs);
 try{
  const clean={...options};delete clean.timeoutMs;
  const res=await fetch(url,{cache:'no-store',...clean,signal:controller.signal});
  const text=await res.text();let body=null;
  try{body=text?JSON.parse(text):null}catch(_){body=text}
  if(!res.ok){const msg=(body&&typeof body==='object'&&(body.message||body.msg||body.error_description||body.error||body.hint||body.details))||text||`HTTP ${res.status}`;throw new Error(`${res.status}: ${msg}`)}
  return body;
 }catch(e){
  if(e?.name==='AbortError')throw new Error('通信タイムアウト（45秒）');
  throw e;
 }finally{clearTimeout(timer)}
}
function saveSession(d){try{localStorage.setItem(TOKEN_KEY,JSON.stringify({access_token:d.access_token,refresh_token:d.refresh_token||'',expires_at:d.expires_at||0,user:d.user}))}catch(_){}}
function loadStoredSession(){try{const s=JSON.parse(localStorage.getItem(TOKEN_KEY)||'null');if(s?.access_token&&s?.user?.id){state.accessToken=s.access_token;state.user=s.user;return true}}catch(_){}return false}
function clearSession(){try{localStorage.removeItem(TOKEN_KEY)}catch(_){}state.accessToken='';state.user=null}
async function ensureAuth(){addDiag('AUTH_START',loadStoredSession()?'stored-session':'new-anonymous');setStatus('認証を確認中…','cloud','','auth-check');if(loadStoredSession()){try{state.user=await jsonFetch(api('/auth/v1/user'),{headers:authHeaders()});return state.user}catch(_){clearSession()}}setStatus('匿名ログイン中…','cloud','','auth-anonymous');let d;try{d=await jsonFetch(api('/auth/v1/signup'),{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({data:{app:'dd-tiktok'}})})}catch(e){d=await jsonFetch(api('/auth/v1/signup'),{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:'{}'}).catch(()=>{throw e})}if(!d?.access_token||!d?.user?.id){addDiag('AUTH_FAIL','access_token/user_id missing');throw new Error('匿名ログインに失敗しました')}state.accessToken=d.access_token;state.user=d.user;saveSession(d);addDiag('AUTH_OK',d.user.id);return d.user}
async function rest(path,options={}){if(!state.accessToken)throw new Error('認証トークンがありません');return jsonFetch(api(`/rest/v1/${path}`),{...options,headers:{...authHeaders(),...(options.headers||{})}})}
async function rpc(name,payload){return rest(`rpc/${name}`,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload||{})})}
async function verifyWorkspace(){addDiag('WORKSPACE_START',cfg.workspaceId||'未設定');setStatus('ワークスペース確認中…','cloud','','workspace');let rows=[];if(cfg.workspaceId)rows=await rest(`workspaces?id=eq.${encodeURIComponent(cfg.workspaceId)}&select=id,name&limit=1`);if(!Array.isArray(rows)||!rows[0]?.id)rows=await rest('workspaces?select=id,name&order=created_at.asc&limit=1');if(!Array.isArray(rows)||!rows[0]?.id)throw new Error('ワークスペースがありません');state.workspaceId=rows[0].id;addDiag('WORKSPACE_OK',state.workspaceId);return state.workspaceId}
function hasOwnerEmergencyUnlock(){try{return localStorage.getItem(OWNER_UNLOCK_KEY)==='1'}catch(_){return false}}
function isOwnerRecoveryDevice(){
  // 既存の本番データを持つ「千葉」端末だけをオーナー復旧対象にする。
  // 新規端末で名前だけを同じにした場合は、空データのため復旧対象にならない。
  const name=getLocalUserName();
  const d=window.db;
  const hasExistingData=Boolean(
    d&&typeof d==='object'&&(
      (Array.isArray(d.devices)&&d.devices.length>0)||
      (Array.isArray(d.entries)&&d.entries.length>0)||
      (Array.isArray(d.members)&&d.members.length>0)
    )
  );
  return hasOwnerEmergencyUnlock()||(name==='千葉'&&hasExistingData);
}
async function sha256Hex(text){const data=new TextEncoder().encode(String(text));const digest=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function ownerPinLockState(){try{const d=JSON.parse(localStorage.getItem(OWNER_FAIL_KEY)||'{}');return {count:Number(d.count||0),lockedUntil:Number(d.lockedUntil||0)}}catch(_){return {count:0,lockedUntil:0}}}
function saveOwnerPinLock(d){try{localStorage.setItem(OWNER_FAIL_KEY,JSON.stringify(d))}catch(_){}}
async function ownerEmergencyUnlock(pin){
  const lock=ownerPinLockState(),now=Date.now();
  if(lock.lockedUntil>now)throw new Error(`暗証番号がロック中です。あと${Math.ceil((lock.lockedUntil-now)/60000)}分お待ちください`);

  if(!state.user)await ensureAuth();
  if(!state.workspaceId)await verifyWorkspace();

  // サーバー側RPCで「今の匿名利用者ID」を正式なオーナーに結び直す。
  // これにより、端末のセッションが変わっても管理者一覧が自分だけになる問題を防ぐ。
  try{
    const rows=await rpc('dd_owner_unlock',{
      target_workspace:state.workspaceId,
      owner_pin:String(pin||'')
    });
    const row=Array.isArray(rows)?rows[0]:rows;
    if(!row||row.status!=='approved'||row.role!=='owner')throw new Error('オーナー登録を確認できませんでした');
  }catch(serverError){
    // 古いDB構成でも画面を完全に締め出さないため、従来の端末内照合を残す。
    const ok=(await sha256Hex(String(pin||'')))==='1b5dae7d0665b854991304a139eeb289021414897e69631761639958fc30a7bd';
    if(!ok){
      const count=lock.count+1;
      if(count>=5){
        saveOwnerPinLock({count:0,lockedUntil:now+15*60*1000});
        throw new Error('5回間違えたため15分間ロックしました');
      }
      saveOwnerPinLock({count,lockedUntil:0});
      throw new Error(`暗証番号が違います（あと${5-count}回）`);
    }
    console.warn('Server owner binding failed; local fallback used:',serverError);
  }

  try{
    localStorage.setItem(OWNER_UNLOCK_KEY,'1');
    localStorage.setItem('dd_owner_role_permanent_v18','owner');
    localStorage.removeItem(OWNER_FAIL_KEY);
  }catch(_){}

  state.role='owner';
  state.accessStatus='approved';
  emitAccess();
  setStatus('オーナーとして接続','cloud','','owner-unlocked');
  try{await pull()}catch(e){console.warn(e)}
  startPresence();
  refreshUI();
  return true;
}
function applyMembership(row){
  const recoveryOwner=isOwnerRecoveryDevice();
  state.role=recoveryOwner?'owner':String(row?.role||'member');
  const storedStatus=String(row?.status||'pending');
  // オーナー端末は、クラウド側の役割・承認状態が崩れていても締め出さない。
  state.accessStatus=state.role==='owner'?'approved':storedStatus;
  emitAccess();
  return row?{...row,role:state.role,status:state.accessStatus}:row;
}
async function repairOwnerMembershipSafe(){
  if(!state.user||!state.workspaceId||!isOwnerRecoveryDevice())return false;
  try{
    await rest(`workspace_members?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&user_id=eq.${encodeURIComponent(state.user.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({role:'owner',status:'approved',approved_at:new Date().toISOString(),approved_by:state.user.id})});
    state.role='owner';state.accessStatus='approved';emitAccess();return true;
  }catch(e){console.warn('Owner membership repair skipped:',e);return false}
}
async function getMembership(){const rows=await rest(`workspace_members?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&user_id=eq.${encodeURIComponent(state.user.id)}&select=role,status,created_at&limit=1`);return applyMembership(Array.isArray(rows)?rows[0]:null)}

function stopAccessPolling(){clearInterval(state.accessTimer);state.accessTimer=null}
function startAccessPolling(){
 stopAccessPolling();
 if(state.accessStatus!=='pending')return;
 state.accessTimer=setInterval(async()=>{
  try{
   const before=state.accessStatus;
   const row=await getMembership();
   if(state.accessStatus==='approved'){
    stopAccessPolling();
    setStatus('チェックイン承認済み','cloud','','approved');
    await pull();
    startPresence();startAutomaticReceive();refreshUI();
   }else if(state.accessStatus!==before){emitAccess()}
  }catch(e){console.warn('access polling:',e)}
 },4000);
}
async function requestAccess(displayName){
 if(!state.user)await ensureAuth();
 if(!state.workspaceId)await verifyWorkspace();
 const name=String(displayName||getLocalUserName()).trim();
 if(!name)throw new Error('名前を入力してください');
 try{localStorage.setItem(LOCAL_USER_KEY,name)}catch(_){}
 addDiag('REQUEST_START',`name=${name} user=${state.user?.id||''} workspace=${state.workspaceId||''}`);
 setStatus('利用申請を確認中…','cloud','','access');
 let rows=null,rpcError=null;
 try{
  rows=await rpc('dd_request_access_device',{target_workspace:state.workspaceId,display_name:name,device_id:getDeviceRegistrationId()});addDiag('RPC_OK',JSON.stringify(rows));
 }catch(e){rpcError=e;addDiag('RPC_FAIL',e.message);console.warn('dd_request_access failed; trying own-row fallback:',e)}
 let rawRow=Array.isArray(rows)?rows[0]:rows;
 // Ver25.25: 1端末1登録を守るため、RPC失敗時の直接INSERTは行わない。
 // 直接INSERTへ逃がすと同じ端末から別user_idが増えるため、SQL未適用時は明示的に停止する。
 if(!rawRow){
  // Ver25.29: SupabaseのRPC確認が一時的に失敗しても、すでに登録済みの本人まで
  // 接続不能にしない。現在のuser_idに既存membershipがある場合だけ安全に継続する。
  // 新規利用者にはこの回避を使わないため、1端末1登録の保護は維持される。
  try{
   const existing=await getMembership();
   if(existing){
    rawRow=existing;
    addDiag('RPC_FALLBACK_EXISTING_MEMBER',JSON.stringify(existing));
    console.warn('Device RPC verification failed; existing membership used safely:',rpcError);
   }
  }catch(fallbackError){
   addDiag('RPC_FALLBACK_FAIL',fallbackError.message);
  }
 }
 if(!rawRow){
  const detail=String(rpcError?.message||'RPC応答なし');
  addDiag('DEVICE_BINDING_REQUIRED',detail);
  throw new Error(`1端末1登録の確認に失敗しました。新規登録は行わず停止しました｜${detail}`);
 }
 rememberDeviceAccount();
 addDiag('MEMBERSHIP_ROW',JSON.stringify(rawRow));
 const row=applyMembership(rawRow);
 if(state.role==='owner')await repairOwnerMembershipSafe();
 if(state.accessStatus==='approved'){
  stopAccessPolling();
  setStatus(state.role==='owner'?'管理者として接続':'承認済み','cloud','','approved');
  const pulled=await pull();
  if(state.role==='owner'&&!pulled?.found&&hasMeaningfulLocalData()){
   state.recoveryProtected=false;
   setStatus('初回クラウド保存中…','cloud','','first-seed');
   const seeded=await push();
   if(!seeded?.ok)throw new Error('初回クラウド保存に失敗しました');
  }
  startPresence();startAutomaticReceive();refreshUI();
 }else{
  setStatus(state.accessStatus==='pending'?'管理者の承認待ちです':state.accessStatus==='suspended'?'利用停止中です':'利用できません','cloud','',state.accessStatus);
  emitAccess();
  if(state.accessStatus==='pending')startAccessPolling();
 }
 return row;
}
function mergeSharedMembers(names=[]){if(!window.db||typeof window.db!=='object')return;const local=getLocalUserName();/* Ver25.22: 所属中の利用者一覧で置き換え、削除済みプロフィールを再混入させない */window.db.members=[...new Set([...names,local].map(v=>String(v||'').trim()).filter(Boolean))];window.db.currentUser=local||String(window.db.currentUser||'').trim()}
async function upsertProfileSafe(){
 const name=getLocalUserName();
 if(!name||!state.user)return;
 try{
  await rest('profiles?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({user_id:state.user.id,workspace_id:state.workspaceId,display_name:name,last_seen_at:new Date().toISOString()})});
 }catch(e){console.warn(e)}
}
async function pullProfilesSafe(){try{
 let rows=[];
 try{
  rows=await rpc('dd_list_workspace_profiles',{target_workspace:state.workspaceId});
 }catch(rpcError){
  console.warn('dd_list_workspace_profiles fallback:',rpcError);
  /* RPC未導入時も、自分以外の古いプロフィールを一覧へ足さない */
  rows=await rest(`profiles?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&user_id=eq.${encodeURIComponent(state.user?.id||'')}&select=user_id,display_name,last_seen_at`);
 }
 state.profiles=Array.isArray(rows)?rows:[];
 const names=state.profiles.map(r=>r?.display_name).filter(Boolean);
 state.applying=true;mergeSharedMembers(names);state.applying=false;
 window.dispatchEvent(new CustomEvent('dd-presence-update',{detail:{profiles:state.profiles}}));
 return names
 }catch(e){console.warn(e);return []}}
function getPresenceByName(name){const n=String(name||'').trim();const rows=(state.profiles||[]).filter(p=>String(p?.display_name||'').trim()===n).sort((a,b)=>new Date(b?.last_seen_at||0)-new Date(a?.last_seen_at||0));const p=rows[0]||null;const ms=p?.last_seen_at?Date.now()-new Date(p.last_seen_at).getTime():Infinity;return {profile:p,isSelf:Boolean(p&&p.user_id===state.user?.id),online:Number.isFinite(ms)&&ms>=0&&ms<120000,lastSeenAt:p?.last_seen_at||null,ageMs:ms}}
async function heartbeat(){
 if(state.accessStatus!=='approved'||document.visibilityState==='hidden')return;
 const name=getLocalUserName();
 if(!name||!state.user||!state.workspaceId)return;
 // Ver25.23: RLSの影響を受けにくい専用RPCで、実際に開いている端末だけ時刻を更新する。
 try{
  await rpc('dd_presence_heartbeat',{target_workspace:state.workspaceId,display_name:name});
 }catch(e){
  console.warn('dd_presence_heartbeat fallback:',e);
  await upsertProfileSafe();
 }
 await pullProfilesSafe();
}
function startPresence(){
 clearInterval(state.presenceTimer);clearInterval(state.profileTimer);
 heartbeat().catch(console.warn);
 state.presenceTimer=setInterval(()=>heartbeat().catch(console.warn),30000);
 state.profileTimer=setInterval(()=>pullProfilesSafe().catch(console.warn),20000);
}
function stopPresence(){clearInterval(state.presenceTimer);clearInterval(state.profileTimer);state.presenceTimer=null;state.profileTimer=null}
// 画面へ戻った瞬間にONLINEを更新。バックグラウンド中は更新しない。
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='visible'){startPresence();pullProfilesSafe().catch(console.warn)}
 else{stopPresence()}
});
window.addEventListener('focus',()=>{if(document.visibilityState==='visible')heartbeat().catch(console.warn)});
window.addEventListener('pageshow',()=>{if(document.visibilityState==='visible')startPresence()});
async function pull(){if(state.accessStatus!=='approved')return {ok:false,reason:'not_approved'};if(state.dirty&&window.db&&hasMeaningfulLocalData()){setStatus('未送信状態を確認中…','cloud','','dirty-check');try{const fixed=await reconcileDirtyStateWithRemote();if(!fixed.cleared){setStatus('未送信データを端末で保護中','cloud','','local-dirty');scheduleRetry();return {ok:true,found:true,skipped:true,reason:'local_dirty'}}}catch(e){setStatus('未送信データを端末で保護中','cloud',e.message,'local-dirty');scheduleRetry();return {ok:true,found:true,skipped:true,reason:'local_dirty'}}}setStatus('クラウドデータ確認中…','cloud','','pull');const rows=await rest(`app_snapshots?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=revision,payload,updated_at&limit=1`);const d=Array.isArray(rows)?rows[0]:null;if(d?.payload&&typeof d.payload==='object'&&Object.keys(d.payload).length){const local=getLocalUserName(),members=Array.isArray(window.db?.members)?window.db.members.slice():[];state.applying=true;window.db=d.payload;if(typeof window.recalculateStoredEntries==='function')window.recalculateStoredEntries(window.db);mergeSharedMembers(members);if(local)window.db.currentUser=local;await pullProfilesSafe();try{const saved=typeof window.compactDBForStorage==='function'?window.compactDBForStorage(window.db):window.db;localStorage.setItem(window.KEY||'dd_tiktok_app_v14_production',JSON.stringify(saved))}catch(_){}state.revision=Number(d.revision||0);state.recoveryProtected=false;state.applying=false;if(!state.entryCursor){state.entryCursor=String(d.updated_at||'1970-01-01T00:00:00.000Z');try{localStorage.setItem(ENTRY_CURSOR_KEY,state.entryCursor)}catch(_){}}setStatus('復元・同期済み','cloud','','ready');return {ok:true,found:true,payload:window.db,revision:state.revision}}setStatus('クラウドは空です','cloud','','empty');return {ok:true,found:false}}
async function confirmRecoveryProtectionCanRelease(){
 if(!state.recoveryProtected)return true;
 if(state.accessStatus!=='approved'||!state.workspaceId||Number(state.revision||0)<=0)return false;
 try{
  addDiag('RECOVERY_CHECK_START',`localRevision=${state.revision}`);
  const rows=await rest(`app_snapshots?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=revision&limit=1`,{timeoutMs:20000});
  const remoteRevision=Number(Array.isArray(rows)&&rows[0]?.revision||0);
  if(remoteRevision>0&&remoteRevision===Number(state.revision||0)){
   state.recoveryProtected=false;
   addDiag('RECOVERY_RELEASED',`revision=${remoteRevision}`);
   setStatus('同期確認済み・共有保存を開始します','cloud','','recovery-released');
   return true;
  }
  addDiag('RECOVERY_KEEP',`local=${state.revision} remote=${remoteRevision}`);
  return false;
 }catch(e){
  addDiag('RECOVERY_CHECK_ERROR',e?.message||String(e));
  return false;
 }
}
async function push(){
 addDiag('1/6 PUSH_START',`dirty=${state.dirty} access=${state.accessStatus} role=${state.role} protected=${state.recoveryProtected}`);
 if(state.recoveryProtected){
  const released=await confirmRecoveryProtectionCanRelease();
  if(!released){addDiag('STOP','recovery_protected');return {ok:false,reason:'recovery_protected'}}
 }
 if(state.accessStatus!=='approved'||state.applying||!window.db){addDiag('STOP',`not_ready access=${state.accessStatus} applying=${state.applying}`);return {ok:false,reason:'not_ready'}}
 if(navigator.onLine===false){markDirty();setStatus('診断 1/6：オフライン','local','','diag-offline');scheduleRetry();return {ok:false,reason:'offline'}}
 const seq=state.dirtySeq||Date.now();state.pushingSeq=seq;
 let snapshot=typeof structuredClone==='function'?structuredClone(window.db):JSON.parse(JSON.stringify(window.db));
 setStatus('診断 1/6：送信準備中','cloud','','diag-prepare');
 try{
  const localJson=JSON.stringify({...snapshot,currentUser:''});
  const localBytes=new Blob([localJson]).size;
  addDiag('1/6 PAYLOAD_READY',`${localBytes} bytes / devices=${snapshot.devices?.length||0} entries=${snapshot.entries?.length||0}`);
  setStatus(`診断 2/6：親データ確認中（${(localBytes/1024/1024).toFixed(1)}MB）`,'cloud','','diag-read-latest');
  addDiag('2/6 READ_REMOTE_START',state.workspaceId);
  const latestRows=await rest(`app_snapshots?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=revision,payload&limit=1`,{timeoutMs:45000});
  addDiag('2/6 READ_REMOTE_OK',`rows=${Array.isArray(latestRows)?latestRows.length:0}`);
  const latest=Array.isArray(latestRows)?latestRows[0]:null;
  setStatus('診断 3/6：変更を統合中','cloud','','diag-merge');
  if(latest?.payload&&typeof latest.payload==='object'){
   snapshot=mergeSnapshots(latest.payload,snapshot);
   state.revision=Math.max(state.revision,Number(latest.revision||0));
   state.applying=true;window.db=snapshot;state.applying=false;
   try{const saved=typeof window.compactDBForStorage==='function'?window.compactDBForStorage(window.db):window.db;localStorage.setItem(window.KEY||'dd_tiktok_app_v14_production',JSON.stringify(saved))}catch(_){}
  }
  const next=Math.max(1,state.revision+1);
  const body=JSON.stringify({workspace_id:state.workspaceId,revision:next,payload:{...snapshot,currentUser:''},updated_by:state.user?.id||null,updated_at:new Date().toISOString()});
  const bytes=new Blob([body]).size;
  addDiag('3/6 MERGE_OK',`revision=${state.revision}->${next} body=${bytes} bytes`);
  setStatus(`診断 4/6：クラウドへ送信中（${(bytes/1024/1024).toFixed(1)}MB）`,'cloud','','diag-upload');
  addDiag('4/6 UPLOAD_START',`${bytes} bytes`);
  const rows=await rest('app_snapshots?on_conflict=workspace_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body,timeoutMs:45000});
  addDiag('4/6 UPLOAD_OK',`rows=${Array.isArray(rows)?rows.length:0}`);
  state.revision=Number(Array.isArray(rows)&&rows[0]?.revision||next);
  setStatus('診断 5/6：利用者情報を更新中','cloud','','diag-profile');
  clearDirty(seq);
  await upsertProfileSafe();
  addDiag('5/6 PROFILE_OK','upsert');
  await pullProfilesSafe();
  addDiag('5/6 PROFILES_OK','pull');
  setStatus('診断 6/6：共有保存完了','cloud','','diag-complete');
  addDiag('6/6 COMPLETE',`revision=${state.revision}`);
  if(state.dirty)queuePush(false);
  return {ok:true,revision:state.revision,bytes};
 }catch(e){
  addDiag('DIAG_ERROR',`${state.stage}: ${e?.message||e}`);
  markDirty();setStatus(`停止位置：${state.status}`,'error',e.message,'diag-error');scheduleRetry();throw e
 }
}
async function restoreBackupSnapshot(payload){
 if(!payload||typeof payload!=='object'||!Array.isArray(payload.devices)||!Array.isArray(payload.entries))throw new Error('復元データの形式が正しくありません');
 if(!state.user)await ensureAuth();
 if(!state.workspaceId)await verifyWorkspace();
 if(state.accessStatus!=='approved')throw new Error('クラウド復元には承認済み権限が必要です');
 // 進行中の自動受信が復元内容へ古いクラウド値を戻さないよう、一度完全に止める。
 stopAutomaticReceive();
 const waitUntil=Date.now()+25000;
 while(state.receiveBusy&&Date.now()<waitUntil)await new Promise(r=>setTimeout(r,120));
 if(state.receiveBusy)throw new Error('別端末データの受信中です。数秒後にもう一度復元してください');
 state.applying=true;
 setStatus('バックアップをクラウドへ確定中…','cloud','','restore-commit');
 try{
  const clean=typeof structuredClone==='function'?structuredClone(payload):JSON.parse(JSON.stringify(payload));
  clean.currentUser='';
  if(typeof window.recalculateStoredEntries==='function')window.recalculateStoredEntries(clean);
  const latestRows=await rest(`app_snapshots?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=revision&limit=1`,{timeoutMs:45000});
  const latest=Array.isArray(latestRows)?latestRows[0]:null;
  const next=Math.max(1,Number(latest?.revision||0)+1,Number(state.revision||0)+1);
  const committedAt=new Date().toISOString();
  const rows=await rest('app_snapshots?on_conflict=workspace_id',{
   method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},
   body:JSON.stringify({workspace_id:state.workspaceId,revision:next,payload:clean,updated_by:state.user.id,updated_at:committedAt}),timeoutMs:45000
  });
  state.revision=Number(Array.isArray(rows)&&rows[0]?.revision||next);
  // 復元以前の1件同期ログを再読込すると、古い数字が復活・上書きされるためカーソルを復元確定時刻へ進める。
  state.entryCursor=String(Array.isArray(rows)&&rows[0]?.updated_at||committedAt);
  state.dirty=false;state.dirtySeq=0;state.recoveryProtected=false;
  try{localStorage.removeItem(DIRTY_KEY);localStorage.removeItem(DIRTY_SEQ_KEY);localStorage.setItem(ENTRY_CURSOR_KEY,state.entryCursor)}catch(_){}
  window.db=clean;
  try{const saved=typeof window.compactDBForStorage==='function'?window.compactDBForStorage(window.db):window.db;localStorage.setItem(window.KEY||'dd_tiktok_app_v14_production',JSON.stringify(saved))}catch(_){}
  setStatus('バックアップ復元を確定しました','cloud','','restore-complete');
  refreshUI();
  return {ok:true,revision:state.revision,updatedAt:state.entryCursor};
 }catch(e){
  markDirty();setStatus('復元データのクラウド確定に失敗','error',e.message,'restore-error');throw e;
 }finally{
  state.applying=false;
  if(document.visibilityState!=='hidden'&&state.accessStatus==='approved')startAutomaticReceive();
 }
}

async function seedCompanyData(payload){
 if(!payload||typeof payload!=='object'||!Array.isArray(payload.devices)||!Array.isArray(payload.entries))throw new Error('親データの形式が正しくありません');
 if(!state.user)await ensureAuth();
 if(!state.workspaceId)await verifyWorkspace();
 if(state.accessStatus!=='approved')throw new Error('承認済みの端末で実行してください');
 if(state.role!=='owner')throw new Error('会社親データを登録できるのはオーナーだけです');
 setStatus('会社親データを登録中…','cloud','','company-seed');
 const latestRows=await rest(`app_snapshots?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=revision&limit=1`);
 const latest=Array.isArray(latestRows)?latestRows[0]:null;
 const next=Math.max(1,Number(latest?.revision||0)+1,Number(state.revision||0)+1);
 const clean=typeof structuredClone==='function'?structuredClone(payload):JSON.parse(JSON.stringify(payload));
 clean.currentUser='';
 const rows=await rest('app_snapshots?on_conflict=workspace_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({workspace_id:state.workspaceId,revision:next,payload:clean,updated_by:state.user.id,updated_at:new Date().toISOString()})});
 state.revision=Number(Array.isArray(rows)&&rows[0]?.revision||next);
 state.recoveryProtected=false;
 state.dirty=false;
 try{localStorage.removeItem(DIRTY_KEY);localStorage.removeItem(DIRTY_SEQ_KEY)}catch(_){}
 state.applying=true;window.db=clean;state.applying=false;
 await upsertProfileSafe();await pullProfilesSafe();
 setStatus('会社親データ登録済み','cloud','','company-seeded');
 refreshUI();
 return {ok:true,revision:state.revision};
}

// Ver25.51: stable single-entry upload for iPhone / Android / edits.
// Uses optimistic concurrency: update only when the cloud revision still matches.
// If another phone saves first, refetch, merge and retry instead of overwriting it.
async function pushEntryById(entryId){
 if(state.accessStatus!=='approved'||!state.workspaceId||!state.user) return {ok:false,reason:'not_ready'};
 if(navigator.onLine===false){markDirty();scheduleRetry();return {ok:false,reason:'offline'}};
 const id=String(entryId||'');
 const localEntry=(window.db?.entries||[]).find(e=>String(e?.id||'')===id);
 if(!localEntry) return {ok:false,reason:'entry_not_found'};
 const did=String(localEntry.deviceId||'');
 const localDevice=(window.db?.devices||[]).find(d=>String(d?.id||'')===did)||null;
 setStatus('入力1件を共有保存中…','cloud','','entry-record-upload');
 try{
  const now=new Date().toISOString();
  const body=JSON.stringify({
   workspace_id:state.workspaceId,
   entry_id:id,
   device_id:did||null,
   entry_data:localEntry,
   device_data:localDevice,
   deleted:false,
   updated_by:state.user.id,
   updated_at:now
  });
  const rows=await rest('app_entry_records?on_conflict=workspace_id,entry_id',{
   method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body,timeoutMs:20000
  });
  const saved=Array.isArray(rows)?rows[0]:null;
  clearDirty(state.dirtySeq);
  setStatus('入力を共有保存しました','cloud','','entry-record-complete');
  return {ok:true,entryId:id,updatedAt:state.entryCursor};
 }catch(e){
  markDirty();scheduleRetry();
  const message=e?.message||'入力1件の共有保存に失敗しました';
  setStatus('入力の共有保存を再試行中','error',message,'entry-record-error');
  return {ok:false,reason:message};
 }
}

async function pullEntryRecords(reason='timer'){
 if(state.receiveBusy||state.applying||state.accessStatus!=='approved'||!state.workspaceId||document.visibilityState==='hidden')return {ok:false,reason:'not_ready'};
 const cursor=state.entryCursor||(()=>{try{return localStorage.getItem(ENTRY_CURSOR_KEY)||'1970-01-01T00:00:00.000Z'}catch(_){return '1970-01-01T00:00:00.000Z'}})();
 state.entryCursor=cursor;
 state.receiveBusy=true;
 try{
  const rows=await rest(`app_entry_records?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&updated_at=gt.${encodeURIComponent(cursor)}&select=entry_id,entry_data,device_data,deleted,updated_at&order=updated_at.asc&limit=500`,{timeoutMs:20000});
  if(!Array.isArray(rows)||!rows.length)return {ok:true,count:0};
  state.applying=true;
  for(const row of rows){
   const id=String(row?.entry_id||'');
   if(!id)continue;
   const pos=(window.db?.entries||[]).findIndex(e=>String(e?.id||'')===id);
   if(row.deleted){if(pos>=0)window.db.entries.splice(pos,1)}
   else if(row.entry_data&&typeof row.entry_data==='object'){
    if(pos>=0)window.db.entries[pos]=row.entry_data;else window.db.entries.push(row.entry_data);
   }
   const dev=row.device_data;
   if(dev&&typeof dev==='object'){
    const did=String(dev.id||'');
    const dp=(window.db?.devices||[]).findIndex(d=>String(d?.id||'')===did);
    if(dp>=0)window.db.devices[dp]=dev;else if(did)window.db.devices.push(dev);
   }
   state.entryCursor=String(row.updated_at||state.entryCursor);
  }
  if(typeof window.recalculateStoredEntries==='function')window.recalculateStoredEntries(window.db);
  try{const saved=typeof window.compactDBForStorage==='function'?window.compactDBForStorage(window.db):window.db;localStorage.setItem(window.KEY||'dd_tiktok_app_v14_production',JSON.stringify(saved))}catch(_){}
  try{localStorage.setItem(ENTRY_CURSOR_KEY,state.entryCursor)}catch(_){}
  state.applying=false;
  refreshUI();
  setStatus(`入力${rows.length}件を受信しました`,'cloud','','entry-record-received');
  return {ok:true,count:rows.length};
 }catch(e){state.applying=false;addDiag('ENTRY_RECEIVE_ERROR',`${reason}: ${e?.message||e}`);return {ok:false,reason:e?.message||String(e)}}
 finally{state.receiveBusy=false}
}

function queuePush(mark=true){if(mark)markDirty();if(state.recoveryProtected||!state.user||state.accessStatus!=='approved'||state.applying)return;clearTimeout(state.syncTimer);state.syncTimer=setTimeout(()=>push().catch(()=>scheduleRetry()),700)}

async function checkForRemoteUpdates(reason='timer'){
 if(state.receiveBusy||state.applying||state.accessStatus!=='approved'||!state.workspaceId||document.visibilityState==='hidden')return {ok:false,reason:'not_ready'};
 state.receiveBusy=true;
 try{
  // Ver25.42: always inspect the remote revision before deciding whether a stale local dirty flag may block receive.
  const rows=await rest(`app_snapshots?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=revision,updated_at,payload&limit=1`);
  const row=Array.isArray(rows)?rows[0]:null;
  const remoteRevision=Number(row?.revision||0);
  if(state.dirty){
   try{
    const fixed=await reconcileDirtyStateWithRemote();
    if(!fixed.cleared){
     addDiag('RECEIVE_DIRTY_PROTECTED',`${reason}: local=${state.revision} remote=${remoteRevision}`);
     scheduleRetry();
     return {ok:false,reason:'local_dirty',remoteRevision};
    }
    // Ver25.43: reconcileDirtyStateWithRemote previously advanced only the revision.
    // That made iPhone report the latest revision while still displaying its old payload.
    // Apply the confirmed remote payload immediately, then recalculate and redraw.
    if(fixed.payload&&typeof fixed.payload==='object'){
     const local=getLocalUserName();
     const members=Array.isArray(window.db?.members)?window.db.members.slice():[];
     state.applying=true;
     window.db=fixed.payload;
     if(typeof window.recalculateStoredEntries==='function')window.recalculateStoredEntries(window.db);
     mergeSharedMembers(members);
     if(local)window.db.currentUser=local;
     try{
      const saved=typeof window.compactDBForStorage==='function'?window.compactDBForStorage(window.db):window.db;
      localStorage.setItem(window.KEY||'dd_tiktok_app_v14_production',JSON.stringify(saved));
     }catch(_){}
     state.applying=false;
     state.recoveryProtected=false;
     setStatus('復元・同期済み','cloud','','ready');
     refreshUI();
     addDiag('DIRTY_REMOTE_APPLIED',`revision=${state.revision}`);
     return {ok:true,updated:true,revision:state.revision};
    }
   }catch(e){
    addDiag('RECEIVE_DIRTY_CHECK_ERROR',String(e?.message||e));
    scheduleRetry();
    return {ok:false,reason:'local_dirty',remoteRevision};
   }
  }
  if(remoteRevision>Number(state.revision||0)){
   addDiag('REMOTE_UPDATE',`${reason}: ${state.revision}->${remoteRevision}`);
   const result=await pull();
   if(result?.found)refreshUI();
   return {ok:true,updated:Boolean(result?.found),revision:state.revision};
  }
  return {ok:true,updated:false,revision:state.revision};
 }catch(e){
  console.warn('automatic receive:',e);
  return {ok:false,error:e.message};
 }finally{state.receiveBusy=false;}
}
function startAutomaticReceive(){
 clearInterval(state.receiveTimer);
 if(state.accessStatus!=='approved')return;
 const tick=async(reason='interval')=>{
  await checkForRemoteUpdates(reason);
  await pullEntryRecords(reason);
 };
 tick('start').catch(console.warn);
 state.receiveTimer=setInterval(()=>tick('interval').catch(console.warn),3000);
}
function stopAutomaticReceive(){clearInterval(state.receiveTimer);state.receiveTimer=null;}

function refreshUI(){
 try{if(typeof window.recalculateStoredEntries==='function')window.recalculateStoredEntries(window.db)}catch(e){console.warn(e)}
 for(const fn of ['ensureLoginMember','updateLoginIdentityUI','renderInputMembers'])try{if(typeof window[fn]==='function')window[fn]()}catch(e){console.warn(e)}
 try{window.markAllScreensDirty?.();window.refreshActiveScreen?.()}catch(e){console.warn(e)}
}
async function listMembers(){
 if(state.role==='owner')await repairOwnerMembershipSafe();
 if(!['owner','admin'].includes(state.role))throw new Error('管理者権限が必要です');
 // RLSで他利用者が隠れる環境でも、管理者専用RPCなら承認待ちを取得できる。
 try{
  const rows=await rpc('dd_admin_list_members',{target_workspace:state.workspaceId});
  if(Array.isArray(rows))return rows.map(m=>({...m,is_self:m.user_id===state.user?.id}));
 }catch(e){console.warn('dd_admin_list_members fallback:',e)}
 const members=await rest(`workspace_members?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=user_id,role,status,created_at,approved_at&order=created_at.asc`);
 const profiles=await rest(`profiles?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=user_id,display_name,last_seen_at`);
 const map=Object.fromEntries((profiles||[]).map(p=>[p.user_id,p]));
 return (members||[]).map(m=>{const isSelf=m.user_id===state.user?.id;return {...m,role:isSelf&&state.role==='owner'?'owner':m.role,status:isSelf&&state.role==='owner'?'approved':m.status,display_name:map[m.user_id]?.display_name||'名前未登録',last_seen_at:map[m.user_id]?.last_seen_at||null,is_self:isSelf}})
}
async function updateMember(userId,patch){
 if(!['owner','admin'].includes(state.role))throw new Error('管理者権限が必要です');
 if(!userId)throw new Error('利用者を特定できません');
 if(userId===state.user?.id)throw new Error('自分自身の権限は変更できません');
 const status=['approved','pending','suspended','rejected'].includes(patch?.status)?patch.status:null;
 const role=state.role==='owner'&&['member','admin'].includes(patch?.role)?patch.role:null;
 if(!status&&!role)throw new Error('変更内容が正しくありません');
 try{
  await rpc('dd_admin_update_member',{target_workspace:state.workspaceId,target_user:userId,new_status:status,new_role:role});
  return true;
 }catch(e){console.warn('dd_admin_update_member fallback:',e)}
 const allowed={};if(status)allowed.status=status;if(role)allowed.role=role;
 if(status==='approved'){allowed.approved_at=new Date().toISOString();allowed.approved_by=state.user.id}
 await rest(`workspace_members?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&user_id=eq.${encodeURIComponent(userId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(allowed)});return true
}
async function init(){if(!configured()){state.role='owner';state.accessStatus='approved';state.recoveryProtected=false;try{localStorage.setItem('dd_owner_emergency_unlock_v1','1');localStorage.setItem('dd_owner_role_permanent_v18','owner')}catch(_){}emitAccess();setStatus('端末内保存・オーナー利用中','local','','ready');return}try{setStatus('Supabaseへ接続中…','cloud','','connect');await ensureAuth();await verifyWorkspace();const name=getLocalUserName();if(name)await requestAccess(name);else{setStatus('名前を登録してください','cloud','','name-required');emitAccess()}}catch(e){console.error(e);setStatus(`接続失敗: ${String(e.message||'不明').slice(0,80)}`,'error',e.message,state.stage||'error')}}

async function recoverFromCloud(displayName,pin){
 const name=String(displayName||'').trim();
 if(!name)throw new Error('お名前を入力してください');
 try{localStorage.setItem(LOCAL_USER_KEY,name)}catch(_){}
 if(!state.user)await ensureAuth();
 if(!state.workspaceId)await verifyWorkspace();
 await requestAccess(name).catch(()=>null);
 if(String(pin||'').trim())await ownerEmergencyUnlock(String(pin).trim());
 if(state.accessStatus!=='approved')throw new Error('クラウド復元には承認済み権限が必要です');
 const result=await pull();
 if(!result?.found)throw new Error('クラウドに復元できるデータが見つかりません。空データは保存していません');
 refreshUI();
 return result;
}

async function listMembersByPin(ownerPin){
  if(!state.user)await ensureAuth();
  if(!state.workspaceId)await verifyWorkspace();
  const rows=await rpc('dd_admin_list_members_pin',{target_workspace:state.workspaceId,owner_pin:String(ownerPin||'')});
  return Array.isArray(rows)?rows.map(m=>({...m,is_self:m.user_id===state.user?.id})):[];
}
async function updateMemberByPin(ownerPin,userId,patch){
  if(!state.user)await ensureAuth();
  if(!state.workspaceId)await verifyWorkspace();
  const status=['approved','pending','suspended','rejected'].includes(patch?.status)?patch.status:null;
  const role=['member','admin'].includes(patch?.role)?patch.role:null;
  return rpc('dd_admin_update_member_pin',{target_workspace:state.workspaceId,owner_pin:String(ownerPin||''),target_user:userId,new_status:status,new_role:role});
}
async function deleteMemberByPin(ownerPin,userId){
  if(!state.user)await ensureAuth();
  if(!state.workspaceId)await verifyWorkspace();
  if(!userId)throw new Error('利用者を特定できません');
  if(userId===state.user?.id)throw new Error('自分自身は削除できません');
  return rpc('dd_admin_delete_member_pin',{target_workspace:state.workspaceId,owner_pin:String(ownerPin||''),target_user:userId});
}
async function renameMemberByPin(ownerPin,userId,newName){
  if(!state.user)await ensureAuth();
  if(!state.workspaceId)await verifyWorkspace();
  const name=String(newName||'').trim();
  if(!name)throw new Error('名前を入力してください');
  const result=await rpc('dd_admin_rename_member_pin',{target_workspace:state.workspaceId,owner_pin:String(ownerPin||''),target_user:userId,new_display_name:name});
  if(userId===state.user?.id){
    try{localStorage.setItem(LOCAL_USER_KEY,name)}catch(_){}
    if(window.db){window.db.currentUser=name;if(Array.isArray(window.db.members)&&!window.db.members.includes(name))window.db.members.unshift(name)}
  }
  await pullProfilesSafe();
  refreshUI();
  return result;
}
async function restoreCurrentOwnerByPin(ownerPin){
  if(!state.user)await ensureAuth();
  if(!state.workspaceId)await verifyWorkspace();
  const rows=await rpc('dd_owner_restore_current_pin',{target_workspace:state.workspaceId,owner_pin:String(ownerPin||'')});
  const row=Array.isArray(rows)?rows[0]:rows;
  if(!row||row.role!=='owner'||row.status!=='approved')throw new Error('オーナー状態を復旧できませんでした');
  try{localStorage.setItem(OWNER_UNLOCK_KEY,'1');localStorage.setItem('dd_owner_role_permanent_v18','owner')}catch(_){}
  state.role='owner';state.accessStatus='approved';emitAccess();setStatus('オーナーとして接続','cloud','','owner-restored');
  await pullProfilesSafe();refreshUI();return row;
}


async function inspectTrackedEntry(deviceName='Air2',date='2026-08-01'){
 if(!state.user)await ensureAuth();
 if(!state.workspaceId)await verifyWorkspace();
 const rows=await rest(`app_snapshots?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=revision,updated_at,payload&limit=1`,{timeoutMs:45000});
 const row=Array.isArray(rows)?rows[0]:null;
 const remote=row?.payload&&typeof row.payload==='object'?row.payload:{};
 const local=window.db&&typeof window.db==='object'?window.db:{};
 const inspect=(db)=>{
  const devices=Array.isArray(db.devices)?db.devices:[];
  const entries=Array.isArray(db.entries)?db.entries:[];
  const dev=devices.find(d=>String(d?.name||'').trim()===deviceName);
  const matches=dev?entries.filter(e=>String(e?.deviceId||'')===String(dev.id||'')&&String(e?.date||'')===date):[];
  matches.sort((a,b)=>Number(a?.timestamp||0)-Number(b?.timestamp||0));
  const e=matches[matches.length-1]||null;
  const day=entries.filter(x=>String(x?.date||'')===date);
  const sum=k=>day.reduce((n,x)=>n+(Number(x?.[k])||0),0);
  return {
   deviceId:String(dev?.id||''),count:matches.length,
   entry:e?{id:String(e.id||''),raw:String(e.raw??e.inputRaw??''),inputValue:Number(e.inputValue||0),operation:String(e.operation||''),increase:Number(e.increase||0),profit:Number(e.profit||0),pending:Number(e.pending||0),discarded:Number(e.discarded||0),timestamp:Number(e.timestamp||0),operator:String(e.operator||'')}:null,
   totals:{increase:sum('increase'),profit:sum('profit'),pending:sum('pending'),discarded:sum('discarded'),count:day.length}
  };
 };
 return {deviceName,date,localRevision:Number(state.revision||0),remoteRevision:Number(row?.revision||0),remoteUpdatedAt:String(row?.updated_at||''),local:inspect(local),remote:inspect(remote)};
}

async function inspectConnection(){
 if(!state.user)await ensureAuth();
 if(!state.workspaceId)await verifyWorkspace();
 const rows=await rest(`app_snapshots?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=revision,updated_at,payload&limit=1`,{timeoutMs:45000});
 const row=Array.isArray(rows)?rows[0]:null;
 const payload=row?.payload&&typeof row.payload==='object'?row.payload:{};
 const local=window.db&&typeof window.db==='object'?window.db:{};
 return {
  version:'25.40',
  endpoint:new URL(base).host,
  configuredWorkspaceId:String(cfg.workspaceId||''),
  activeWorkspaceId:String(state.workspaceId||''),
  localRevision:Number(state.revision||0),
  remoteRevision:Number(row?.revision||0),
  remoteUpdatedAt:String(row?.updated_at||''),
  localDevices:Array.isArray(local.devices)?local.devices.length:0,
  remoteDevices:Array.isArray(payload.devices)?payload.devices.length:0,
  localEntries:Array.isArray(local.entries)?local.entries.length:0,
  remoteEntries:Array.isArray(payload.entries)?payload.entries.length:0,
  dirty:Boolean(state.dirty),
  userId:String(state.user?.id||''),
  role:String(state.role||''),
  accessStatus:String(state.accessStatus||''),
  stage:String(state.stage||''),
  status:String(state.status||''),
  error:String(state.lastError||'')
 };
}
window.DDCloud={state,isConfigured:configured,init,pull,push,pushEntryById,pullEntryRecords,restoreBackupSnapshot,seedCompanyData,queuePush,requestAccess,recoverFromCloud,getMembership,listMembers,updateMember,listMembersByPin,updateMemberByPin,deleteMemberByPin,renameMemberByPin,restoreCurrentOwnerByPin,getPresenceByName,heartbeat,checkForRemoteUpdates,ownerEmergencyUnlock,inspectConnection,inspectTrackedEntry,async syncNow(){return push()},async getCurrentUser(){return state.user},getLastError(){return state.lastError},async refreshMembers(){const n=await pullProfilesSafe();refreshUI();return n},getDiagnostics(){return {version:'25.61',configured:configured(),stage:state.stage,status:state.status,error:state.lastError,workspaceId:state.workspaceId||cfg.workspaceId||'',authenticated:Boolean(state.user&&state.accessToken),userId:state.user?.id||'',role:state.role,accessStatus:state.accessStatus,revision:Number(state.revision||0),dirty:Boolean(state.dirty),endpoint:base?new URL(base).host:'',trace:diag.slice()}},async runCheckinDiagnostics(displayName){diag.length=0;addDiag('DIAG_START',navigator.userAgent);try{await ensureAuth();await verifyWorkspace();const row=await requestAccess(displayName||getLocalUserName());addDiag('DIAG_DONE',JSON.stringify(row||null));return this.getDiagnostics()}catch(e){addDiag('DIAG_ERROR',e.message);setStatus('診断エラー','error',e.message,'diagnostic');throw e}},async importData(payload){if(!payload||typeof payload!=='object')throw new Error('形式が正しくありません');return {ok:true,mode:'preview',records:Object.keys(payload).length}}};
function hookPersist(){if(typeof window.persist!=='function'||window.persist.__ddCloudHooked)return;const orig=window.persist;const wrapped=function(){return orig.apply(this,arguments)};wrapped.__ddCloudHooked=true;window.persist=wrapped}
window.addEventListener('DOMContentLoaded',()=>{hookPersist();setTimeout(hookPersist,800);setTimeout(init,350)});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.accessStatus==='approved'){startAutomaticReceive();heartbeat().catch(console.warn);checkForRemoteUpdates('visible')}else{stopAutomaticReceive()}});
window.addEventListener('focus',()=>{if(state.accessStatus==='approved'){startAutomaticReceive();heartbeat().catch(console.warn);checkForRemoteUpdates('focus')}});
window.addEventListener('pageshow',()=>{if(state.accessStatus==='approved'){startAutomaticReceive();checkForRemoteUpdates('pageshow')}});
window.addEventListener('online',()=>{checkForRemoteUpdates('online')});
})();
