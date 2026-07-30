/* D&D❀TikTok Ver17.5.4 cloud bridge - owner PIN recovery */
(()=>{
'use strict';
const cfg=window.DD_BACKEND_CONFIG||{};
const TOKEN_KEY='dd_supabase_anon_session_v2', LOCAL_USER_KEY='dd_tiktok_local_user_v1', OWNER_UNLOCK_KEY='dd_owner_emergency_unlock_v1', OWNER_FAIL_KEY='dd_owner_pin_fail_v1';
const state={mode:'local',status:'起動中…',stage:'boot',user:null,accessToken:'',workspaceId:'',revision:0,syncTimer:null,presenceTimer:null,profileTimer:null,applying:false,lastError:'',role:'',accessStatus:'unknown',profiles:[]};
const publicState=()=>({...state,syncTimer:undefined,presenceTimer:undefined,profileTimer:undefined,accessToken:undefined,user:state.user?{id:state.user.id}:null});
const emit=()=>window.dispatchEvent(new CustomEvent('dd-cloud-status',{detail:publicState()}));
const emitAccess=()=>window.dispatchEvent(new CustomEvent('dd-access-state',{detail:publicState()}));
function setStatus(status,mode=state.mode,error='',stage=state.stage){state.status=status;state.mode=mode;state.lastError=error||'';state.stage=stage||'';document.documentElement.dataset.storageMode=mode;document.documentElement.dataset.cloudStage=state.stage;emit()}
const configured=()=>Boolean(cfg.enabled&&cfg.provider==='supabase'&&cfg.url&&cfg.anonKey&&cfg.workspaceId);
const base=String(cfg.url||'').replace(/\/+$/,''), api=p=>`${base}${p}`;
const authHeaders=()=>({apikey:cfg.anonKey,Authorization:`Bearer ${state.accessToken}`,'Content-Type':'application/json'});
const getLocalUserName=()=>{try{return String(localStorage.getItem(LOCAL_USER_KEY)||'').trim()}catch(_){return ''}};
async function jsonFetch(url,options={}){const res=await fetch(url,{cache:'no-store',...options});const text=await res.text();let body=null;try{body=text?JSON.parse(text):null}catch(_){body=text}if(!res.ok){const msg=(body&&typeof body==='object'&&(body.message||body.msg||body.error_description||body.error||body.hint||body.details))||text||`HTTP ${res.status}`;throw new Error(`${res.status}: ${msg}`)}return body}
function saveSession(d){try{localStorage.setItem(TOKEN_KEY,JSON.stringify({access_token:d.access_token,refresh_token:d.refresh_token||'',expires_at:d.expires_at||0,user:d.user}))}catch(_){}}
function loadStoredSession(){try{const s=JSON.parse(localStorage.getItem(TOKEN_KEY)||'null');if(s?.access_token&&s?.user?.id){state.accessToken=s.access_token;state.user=s.user;return true}}catch(_){}return false}
function clearSession(){try{localStorage.removeItem(TOKEN_KEY)}catch(_){}state.accessToken='';state.user=null}
async function ensureAuth(){setStatus('認証を確認中…','cloud','','auth-check');if(loadStoredSession()){try{state.user=await jsonFetch(api('/auth/v1/user'),{headers:authHeaders()});return state.user}catch(_){clearSession()}}setStatus('匿名ログイン中…','cloud','','auth-anonymous');let d;try{d=await jsonFetch(api('/auth/v1/signup'),{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({data:{app:'dd-tiktok'}})})}catch(e){d=await jsonFetch(api('/auth/v1/signup'),{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:'{}'}).catch(()=>{throw e})}if(!d?.access_token||!d?.user?.id)throw new Error('匿名ログインに失敗しました');state.accessToken=d.access_token;state.user=d.user;saveSession(d);return d.user}
async function rest(path,options={}){if(!state.accessToken)throw new Error('認証トークンがありません');return jsonFetch(api(`/rest/v1/${path}`),{...options,headers:{...authHeaders(),...(options.headers||{})}})}
async function rpc(name,payload){return rest(`rpc/${name}`,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload||{})})}
async function verifyWorkspace(){setStatus('ワークスペース確認中…','cloud','','workspace');let rows=[];if(cfg.workspaceId)rows=await rest(`workspaces?id=eq.${encodeURIComponent(cfg.workspaceId)}&select=id,name&limit=1`);if(!Array.isArray(rows)||!rows[0]?.id)rows=await rest('workspaces?select=id,name&order=created_at.asc&limit=1');if(!Array.isArray(rows)||!rows[0]?.id)throw new Error('ワークスペースがありません');state.workspaceId=rows[0].id;return state.workspaceId}
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
  const ok=(await sha256Hex(String(pin||'')))==='1b5dae7d0665b854991304a139eeb289021414897e69631761639958fc30a7bd';
  if(!ok){const count=lock.count+1;if(count>=5){saveOwnerPinLock({count:0,lockedUntil:now+15*60*1000});throw new Error('5回間違えたため15分間ロックしました')}saveOwnerPinLock({count,lockedUntil:0});throw new Error(`暗証番号が違います（あと${5-count}回）`)}
  try{localStorage.setItem(OWNER_UNLOCK_KEY,'1');localStorage.removeItem(OWNER_FAIL_KEY)}catch(_){}
  state.role='owner';state.accessStatus='approved';emitAccess();setStatus('オーナーとして緊急入室','cloud','','owner-unlocked');
  try{if(state.user&&state.workspaceId)await rest(`workspace_members?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&user_id=eq.${encodeURIComponent(state.user.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({role:'owner',status:'approved',approved_at:new Date().toISOString(),approved_by:state.user.id})})}catch(e){console.warn('Owner role cloud update skipped:',e)}
  try{await pull()}catch(e){console.warn(e)}startPresence();refreshUI();return true;
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
async function getMembership(){const rows=await rest(`workspace_members?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&user_id=eq.${encodeURIComponent(state.user.id)}&select=role,status,created_at&limit=1`);return applyMembership(Array.isArray(rows)?rows[0]:null)}
async function requestAccess(displayName){if(!state.user)await ensureAuth();if(!state.workspaceId)await verifyWorkspace();const name=String(displayName||getLocalUserName()).trim();if(!name)throw new Error('名前を入力してください');setStatus('利用申請を確認中…','cloud','','access');const rows=await rpc('dd_request_access',{target_workspace:state.workspaceId,display_name:name});const row=applyMembership(Array.isArray(rows)?rows[0]:rows);if(state.accessStatus==='approved'){setStatus(state.role==='owner'?'管理者として接続':'承認済み','cloud','','approved');await pull();startPresence();refreshUI()}else{setStatus(state.accessStatus==='pending'?'管理者の承認待ちです':state.accessStatus==='suspended'?'利用停止中です':'利用できません','cloud','',state.accessStatus);emitAccess()}return row}
function mergeSharedMembers(names=[]){if(!window.db||typeof window.db!=='object')return;const local=getLocalUserName(),cur=Array.isArray(window.db.members)?window.db.members:[];window.db.members=[...new Set([...cur,...names,local].map(v=>String(v||'').trim()).filter(Boolean))];window.db.currentUser=local||String(window.db.currentUser||'').trim()}
async function upsertProfileSafe(){const name=String(window.db?.currentUser||getLocalUserName()).trim();if(!name||!state.user)return;try{await rest('profiles?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({user_id:state.user.id,workspace_id:state.workspaceId,display_name:name,last_seen_at:new Date().toISOString()})})}catch(e){console.warn(e)}}
async function pullProfilesSafe(){try{const rows=await rest(`profiles?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=user_id,display_name,last_seen_at&order=display_name.asc`);state.profiles=Array.isArray(rows)?rows:[];const names=state.profiles.map(r=>r?.display_name).filter(Boolean);state.applying=true;mergeSharedMembers(names);state.applying=false;window.dispatchEvent(new CustomEvent('dd-presence-update',{detail:{profiles:state.profiles}}));return names}catch(e){console.warn(e);return []}}
function getPresenceByName(name){const n=String(name||'').trim();const rows=(state.profiles||[]).filter(p=>String(p?.display_name||'').trim()===n).sort((a,b)=>new Date(b?.last_seen_at||0)-new Date(a?.last_seen_at||0));const p=rows[0]||null;const ms=p?.last_seen_at?Date.now()-new Date(p.last_seen_at).getTime():Infinity;return {profile:p,isSelf:Boolean(p&&p.user_id===state.user?.id),online:Number.isFinite(ms)&&ms>=0&&ms<120000,lastSeenAt:p?.last_seen_at||null,ageMs:ms}}
async function heartbeat(){if(state.accessStatus!=='approved'||document.visibilityState==='hidden')return;await upsertProfileSafe();await pullProfilesSafe();refreshUI()}
function startPresence(){clearInterval(state.presenceTimer);clearInterval(state.profileTimer);heartbeat().catch(console.warn);state.presenceTimer=setInterval(()=>heartbeat().catch(console.warn),45000);state.profileTimer=setInterval(()=>pullProfilesSafe().then(refreshUI).catch(console.warn),30000)}
async function pull(){if(state.accessStatus!=='approved')return {ok:false,reason:'not_approved'};setStatus('クラウドデータ確認中…','cloud','','pull');const rows=await rest(`app_snapshots?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=revision,payload,updated_at&limit=1`);const d=Array.isArray(rows)?rows[0]:null;if(d?.payload&&typeof d.payload==='object'&&Object.keys(d.payload).length){const local=getLocalUserName(),members=Array.isArray(window.db?.members)?window.db.members.slice():[];state.applying=true;window.db=d.payload;mergeSharedMembers(members);if(local)window.db.currentUser=local;await pullProfilesSafe();try{localStorage.setItem(window.KEY||'dd_tiktok_app_v14_production',JSON.stringify(window.db))}catch(_){}state.revision=Number(d.revision||0);state.applying=false;setStatus('同期済み','cloud','','ready');return {ok:true,found:true,payload:window.db,revision:state.revision}}setStatus('クラウドは空です','cloud','','empty');return {ok:true,found:false}}
async function push(){if(state.accessStatus!=='approved'||state.applying||!window.db)return {ok:false,reason:'not_ready'};setStatus('クラウドへ保存中…','cloud','','push');const next=Math.max(1,state.revision+1);const rows=await rest('app_snapshots?on_conflict=workspace_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({workspace_id:state.workspaceId,revision:next,payload:{...window.db,currentUser:''},updated_by:state.user?.id||null,updated_at:new Date().toISOString()})});state.revision=Number(Array.isArray(rows)&&rows[0]?.revision||next);await upsertProfileSafe();await pullProfilesSafe();setStatus('同期済み','cloud','','ready');return {ok:true,revision:state.revision}}
function queuePush(){if(!state.user||state.accessStatus!=='approved'||state.applying)return;clearTimeout(state.syncTimer);state.syncTimer=setTimeout(()=>push().catch(e=>setStatus('同期エラー','error',e.message,'push-error')),700)}
function refreshUI(){for(const fn of ['recalculateStoredEntries','ensureLoginMember','updateLoginIdentityUI','renderInputMembers','renderHome'])try{if(typeof window[fn]==='function')window[fn](fn==='recalculateStoredEntries'?window.db:undefined)}catch(e){console.warn(e)}}
async function listMembers(){if(!['owner','admin'].includes(state.role))throw new Error('管理者権限が必要です');const members=await rest(`workspace_members?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=user_id,role,status,created_at,approved_at&order=created_at.asc`);const profiles=await rest(`profiles?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=user_id,display_name,last_seen_at`);const map=Object.fromEntries((profiles||[]).map(p=>[p.user_id,p]));return (members||[]).map(m=>({...m,display_name:map[m.user_id]?.display_name||'名前未登録',last_seen_at:map[m.user_id]?.last_seen_at||null,is_self:m.user_id===state.user?.id}))}
async function updateMember(userId,patch){if(!['owner','admin'].includes(state.role))throw new Error('管理者権限が必要です');const body={...patch};if(patch.status==='approved'){body.approved_at=new Date().toISOString();body.approved_by=state.user.id}await rest(`workspace_members?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&user_id=eq.${encodeURIComponent(userId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});return true}
async function init(){if(!configured()){setStatus('設定不足・端末内保存','local','backend-config.jsの設定不足','config');return}try{setStatus('Supabaseへ接続中…','cloud','','connect');await ensureAuth();await verifyWorkspace();const name=getLocalUserName();if(name)await requestAccess(name);else{setStatus('名前を登録してください','cloud','','name-required');emitAccess()}}catch(e){console.error(e);setStatus(`接続失敗: ${String(e.message||'不明').slice(0,80)}`,'error',e.message,state.stage||'error')}}
window.DDCloud={state,isConfigured:configured,init,pull,push,queuePush,requestAccess,getMembership,listMembers,updateMember,getPresenceByName,heartbeat,ownerEmergencyUnlock,async syncNow(){return push()},async getCurrentUser(){return state.user},getLastError(){return state.lastError},async refreshMembers(){const n=await pullProfilesSafe();refreshUI();return n},getDiagnostics(){return {configured:configured(),stage:state.stage,status:state.status,error:state.lastError,workspaceId:state.workspaceId||cfg.workspaceId||'',authenticated:Boolean(state.user&&state.accessToken),role:state.role,accessStatus:state.accessStatus}},async importData(payload){if(!payload||typeof payload!=='object')throw new Error('形式が正しくありません');return {ok:true,mode:'preview',records:Object.keys(payload).length}}};
function hookPersist(){if(typeof window.persist!=='function'||window.persist.__ddCloudHooked)return;const orig=window.persist;const wrapped=function(){const r=orig.apply(this,arguments);queuePush();return r};wrapped.__ddCloudHooked=true;window.persist=wrapped}
window.addEventListener('DOMContentLoaded',()=>{hookPersist();setTimeout(init,350)});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.accessStatus==='approved')heartbeat().catch(console.warn)});
window.addEventListener('focus',()=>{if(state.accessStatus==='approved')heartbeat().catch(console.warn)});
})();
