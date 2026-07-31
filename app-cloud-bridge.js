/* D&D❀TikTok Ver25.17 owner repair and member rename bridge */
(()=>{
'use strict';
const cfg=window.DD_BACKEND_CONFIG||{};
const TOKEN_KEY='dd_supabase_anon_session_v2', LOCAL_USER_KEY='dd_tiktok_local_user_v1', OWNER_UNLOCK_KEY='dd_owner_emergency_unlock_v1', OWNER_FAIL_KEY='dd_owner_pin_fail_v1';
const diag=[];
function addDiag(step,detail=''){const row={time:new Date().toISOString(),step:String(step),detail:String(detail||'')};diag.push(row);if(diag.length>30)diag.shift();console.log('[DD DIAG]',row);return row}
const state={mode:'local',status:'起動中…',stage:'boot',user:null,accessToken:'',workspaceId:'',revision:0,syncTimer:null,presenceTimer:null,profileTimer:null,accessTimer:null,applying:false,lastError:'',role:'',accessStatus:'unknown',profiles:[],recoveryProtected:true};
const publicState=()=>({...state,syncTimer:undefined,presenceTimer:undefined,profileTimer:undefined,accessTimer:undefined,accessToken:undefined,user:state.user?{id:state.user.id}:null});
const emit=()=>window.dispatchEvent(new CustomEvent('dd-cloud-status',{detail:publicState()}));
const emitAccess=()=>window.dispatchEvent(new CustomEvent('dd-access-state',{detail:publicState()}));
function setStatus(status,mode=state.mode,error='',stage=state.stage){state.status=status;state.mode=mode;state.lastError=error||'';state.stage=stage||'';document.documentElement.dataset.storageMode=mode;document.documentElement.dataset.cloudStage=state.stage;emit()}
const configured=()=>Boolean(cfg.enabled&&cfg.provider==='supabase'&&cfg.url&&cfg.anonKey&&cfg.workspaceId);
const base=String(cfg.url||'').replace(/\/+$/,''), api=p=>`${base}${p}`;
const authHeaders=()=>({apikey:cfg.anonKey,Authorization:`Bearer ${state.accessToken}`,'Content-Type':'application/json'});
const getLocalUserName=()=>{try{return String(localStorage.getItem(LOCAL_USER_KEY)||'').trim()}catch(_){return ''}};
function hasMeaningfulLocalData(){const d=window.db;return Boolean(d&&typeof d==='object'&&((Array.isArray(d.devices)&&d.devices.length>0)||(Array.isArray(d.entries)&&d.entries.length>0)||(Array.isArray(d.invites)&&d.invites.length>0)));}
async function jsonFetch(url,options={}){const res=await fetch(url,{cache:'no-store',...options});const text=await res.text();let body=null;try{body=text?JSON.parse(text):null}catch(_){body=text}if(!res.ok){const msg=(body&&typeof body==='object'&&(body.message||body.msg||body.error_description||body.error||body.hint||body.details))||text||`HTTP ${res.status}`;throw new Error(`${res.status}: ${msg}`)}return body}
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
    startPresence();refreshUI();
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
  rows=await rpc('dd_request_access',{target_workspace:state.workspaceId,display_name:name});addDiag('RPC_OK',JSON.stringify(rows));
 }catch(e){rpcError=e;addDiag('RPC_FAIL',e.message);console.warn('dd_request_access failed; trying own-row fallback:',e)}
 let rawRow=Array.isArray(rows)?rows[0]:rows;
 // 新規端末でRPCが失敗・空応答になった場合、自分自身の申請行だけを直接登録して再確認する。
 if(!rawRow){
  try{
   await rest('workspace_members?on_conflict=workspace_id,user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({workspace_id:state.workspaceId,user_id:state.user.id,role:'member',status:'pending',created_at:new Date().toISOString()})});
   try{await rest('profiles?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({user_id:state.user.id,workspace_id:state.workspaceId,display_name:name,last_seen_at:new Date().toISOString()})})}catch(profileError){console.warn('profile fallback skipped:',profileError)}
   const verify=await rest(`workspace_members?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&user_id=eq.${encodeURIComponent(state.user.id)}&select=role,status,created_at&limit=1`);
   rawRow=Array.isArray(verify)?verify[0]:verify;addDiag('FALLBACK_VERIFY',JSON.stringify(rawRow||null));
  }catch(fallbackError){
   const a=String(rpcError?.message||'RPC応答なし');
   const b=String(fallbackError?.message||'申請登録失敗');
   addDiag('FALLBACK_FAIL',`${a} / ${b}`);throw new Error(`新規利用申請を登録できませんでした｜RPC: ${a}｜登録: ${b}`);
  }
 }
 if(!rawRow)throw new Error('利用申請の登録確認ができませんでした');
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
  startPresence();refreshUI();
 }else{
  setStatus(state.accessStatus==='pending'?'管理者の承認待ちです':state.accessStatus==='suspended'?'利用停止中です':'利用できません','cloud','',state.accessStatus);
  emitAccess();
  if(state.accessStatus==='pending')startAccessPolling();
 }
 return row;
}
function mergeSharedMembers(names=[]){if(!window.db||typeof window.db!=='object')return;const local=getLocalUserName(),cur=Array.isArray(window.db.members)?window.db.members:[];window.db.members=[...new Set([...cur,...names,local].map(v=>String(v||'').trim()).filter(Boolean))];window.db.currentUser=local||String(window.db.currentUser||'').trim()}
async function upsertProfileSafe(){const name=String(window.db?.currentUser||getLocalUserName()).trim();if(!name||!state.user)return;try{await rest('profiles?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({user_id:state.user.id,workspace_id:state.workspaceId,display_name:name,last_seen_at:new Date().toISOString()})})}catch(e){console.warn(e)}}
async function pullProfilesSafe(){try{const rows=await rest(`profiles?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=user_id,display_name,last_seen_at&order=display_name.asc`);state.profiles=Array.isArray(rows)?rows:[];const names=state.profiles.map(r=>r?.display_name).filter(Boolean);state.applying=true;mergeSharedMembers(names);state.applying=false;window.dispatchEvent(new CustomEvent('dd-presence-update',{detail:{profiles:state.profiles}}));return names}catch(e){console.warn(e);return []}}
function getPresenceByName(name){const n=String(name||'').trim();const rows=(state.profiles||[]).filter(p=>String(p?.display_name||'').trim()===n).sort((a,b)=>new Date(b?.last_seen_at||0)-new Date(a?.last_seen_at||0));const p=rows[0]||null;const ms=p?.last_seen_at?Date.now()-new Date(p.last_seen_at).getTime():Infinity;return {profile:p,isSelf:Boolean(p&&p.user_id===state.user?.id),online:Number.isFinite(ms)&&ms>=0&&ms<120000,lastSeenAt:p?.last_seen_at||null,ageMs:ms}}
async function heartbeat(){if(state.accessStatus!=='approved'||document.visibilityState==='hidden')return;await upsertProfileSafe();await pullProfilesSafe()}
function startPresence(){clearInterval(state.presenceTimer);clearInterval(state.profileTimer);heartbeat().catch(console.warn);state.presenceTimer=setInterval(()=>heartbeat().catch(console.warn),45000);state.profileTimer=setInterval(()=>pullProfilesSafe().catch(console.warn),30000)}
async function pull(){if(state.accessStatus!=='approved')return {ok:false,reason:'not_approved'};setStatus('クラウドデータ確認中…','cloud','','pull');const rows=await rest(`app_snapshots?workspace_id=eq.${encodeURIComponent(state.workspaceId)}&select=revision,payload,updated_at&limit=1`);const d=Array.isArray(rows)?rows[0]:null;if(d?.payload&&typeof d.payload==='object'&&Object.keys(d.payload).length){const local=getLocalUserName(),members=Array.isArray(window.db?.members)?window.db.members.slice():[];state.applying=true;window.db=d.payload;mergeSharedMembers(members);if(local)window.db.currentUser=local;await pullProfilesSafe();try{const saved=typeof window.compactDBForStorage==='function'?window.compactDBForStorage(window.db):window.db;localStorage.setItem(window.KEY||'dd_tiktok_app_v14_production',JSON.stringify(saved))}catch(_){}state.revision=Number(d.revision||0);state.recoveryProtected=false;state.applying=false;setStatus('復元・同期済み','cloud','','ready');return {ok:true,found:true,payload:window.db,revision:state.revision}}setStatus('クラウドは空です','cloud','','empty');return {ok:true,found:false}}
async function push(){if(state.recoveryProtected)return {ok:false,reason:'recovery_protected'};if(state.accessStatus!=='approved'||state.applying||!window.db)return {ok:false,reason:'not_ready'};setStatus('クラウドへ保存中…','cloud','','push');const next=Math.max(1,state.revision+1);const rows=await rest('app_snapshots?on_conflict=workspace_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({workspace_id:state.workspaceId,revision:next,payload:{...window.db,currentUser:''},updated_by:state.user?.id||null,updated_at:new Date().toISOString()})});state.revision=Number(Array.isArray(rows)&&rows[0]?.revision||next);await upsertProfileSafe();await pullProfilesSafe();setStatus('同期済み','cloud','','ready');return {ok:true,revision:state.revision}}
function queuePush(){if(state.recoveryProtected||!state.user||state.accessStatus!=='approved'||state.applying)return;clearTimeout(state.syncTimer);state.syncTimer=setTimeout(()=>push().catch(e=>setStatus('同期エラー','error',e.message,'push-error')),700)}
function refreshUI(){for(const fn of ['recalculateStoredEntries','ensureLoginMember','updateLoginIdentityUI','renderInputMembers','renderHome'])try{if(typeof window[fn]==='function')window[fn](fn==='recalculateStoredEntries'?window.db:undefined)}catch(e){console.warn(e)}}
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
async function init(){if(!configured()){setStatus('設定不足・端末内保存','local','backend-config.jsの設定不足','config');return}try{setStatus('Supabaseへ接続中…','cloud','','connect');await ensureAuth();await verifyWorkspace();const name=getLocalUserName();if(name)await requestAccess(name);else{setStatus('名前を登録してください','cloud','','name-required');emitAccess()}}catch(e){console.error(e);setStatus(`接続失敗: ${String(e.message||'不明').slice(0,80)}`,'error',e.message,state.stage||'error')}}

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

window.DDCloud={state,isConfigured:configured,init,pull,push,queuePush,requestAccess,recoverFromCloud,getMembership,listMembers,updateMember,listMembersByPin,updateMemberByPin,renameMemberByPin,restoreCurrentOwnerByPin,getPresenceByName,heartbeat,ownerEmergencyUnlock,async syncNow(){return push()},async getCurrentUser(){return state.user},getLastError(){return state.lastError},async refreshMembers(){const n=await pullProfilesSafe();refreshUI();return n},getDiagnostics(){return {version:'25.17',configured:configured(),stage:state.stage,status:state.status,error:state.lastError,workspaceId:state.workspaceId||cfg.workspaceId||'',authenticated:Boolean(state.user&&state.accessToken),userId:state.user?.id||'',role:state.role,accessStatus:state.accessStatus,trace:diag.slice()}},async runCheckinDiagnostics(displayName){diag.length=0;addDiag('DIAG_START',navigator.userAgent);try{await ensureAuth();await verifyWorkspace();const row=await requestAccess(displayName||getLocalUserName());addDiag('DIAG_DONE',JSON.stringify(row||null));return this.getDiagnostics()}catch(e){addDiag('DIAG_ERROR',e.message);setStatus('診断エラー','error',e.message,'diagnostic');throw e}},async importData(payload){if(!payload||typeof payload!=='object')throw new Error('形式が正しくありません');return {ok:true,mode:'preview',records:Object.keys(payload).length}}};
function hookPersist(){if(typeof window.persist!=='function'||window.persist.__ddCloudHooked)return;const orig=window.persist;const wrapped=function(){const r=orig.apply(this,arguments);queuePush();return r};wrapped.__ddCloudHooked=true;window.persist=wrapped}
window.addEventListener('DOMContentLoaded',()=>{hookPersist();setTimeout(hookPersist,800);setTimeout(init,350)});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.accessStatus==='approved')heartbeat().catch(console.warn)});
window.addEventListener('focus',()=>{if(state.accessStatus==='approved')heartbeat().catch(console.warn)});
})();
