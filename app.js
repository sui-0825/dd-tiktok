'use strict';
const STORAGE_KEY='dd_tiktok_v26_stable_local';
const LEGACY_KEY='dd_tiktok_app_v14_production';
const BACKUP_SCHEMA_VERSION=26;
const $=id=>document.getElementById(id);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2);
const dkey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const yen=n=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(n||0));
const emptyDB=()=>({version:26,devices:[],entries:[],finance:{monthly:{},targets:{},initialInvestment:0},currentUser:'',members:[],security:{}});
let db=loadDB();

function loadDB(){
  for(const key of [STORAGE_KEY,LEGACY_KEY]){
    try{const x=JSON.parse(localStorage.getItem(key)||'null');if(x&&Array.isArray(x.devices)&&Array.isArray(x.entries))return normalize(x)}catch(_){ }
  }
  return emptyDB();
}
function normalize(x){
  return {...emptyDB(),...x,devices:Array.isArray(x.devices)?x.devices:[],entries:Array.isArray(x.entries)?x.entries:[],finance:{monthly:{},targets:{},initialInvestment:0,...(x.finance||{})}};
}
function persist(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
  localStorage.setItem('dd_v26_last_save',String(Date.now()));
}
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800)}
function parseRaw(input){
  const raw=String(input||'').trim().replace(/,/g,'');
  if(!raw)throw new Error('入力値を入れてください');
  if(raw==='-')return {raw,kind:'error',value:0,exchange:0,take:false};
  const double=raw.endsWith('!!');
  const take=raw.endsWith('!')&&!double;
  const clean=raw.replace(/!!$/,'').replace(/!$/,'');
  const parts=clean.split('@');
  const value=Number(parts[0]);
  if(!Number.isFinite(value)||value<0)throw new Error('入力形式を確認してください');
  let exchange=0;
  if(double)exchange=15000;
  else if(parts.length>1){exchange=Number(parts[1]);if(!Number.isFinite(exchange)||exchange<0)throw new Error('@の金額を確認してください')}
  else if(take)exchange=value;
  return {raw,kind:double?'double':parts.length>1?(take?'partialtake':'partial'):take?'take':'normal',value,exchange,take};
}
function calculate(prevPending,p){
  if(p.kind==='error')return {increase:0,paypay:0,waste:0,pending:prevPending};
  if(p.take)return {increase:0,paypay:p.exchange,waste:Math.max(0,p.value-p.exchange),pending:0};
  return {increase:Math.max(0,p.value-prevPending),paypay:p.exchange,waste:0,pending:p.value};
}
function entriesFor(deviceId){return db.entries.filter(e=>e.deviceId===deviceId).sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0))}
function recalcDevice(deviceId){let prev=0;for(const e of entriesFor(deviceId)){const p=parseRaw(e.raw||e.inputRaw||'');Object.assign(e,p,calculate(prev,p));e.inputRaw=e.raw;e.month=String(e.date||'').slice(0,7);e.year=String(e.date||'').slice(0,4);prev=Number(e.pending||0)}}
function totals(filter){return db.entries.filter(filter).reduce((a,e)=>{a.increase+=Number(e.increase||0);a.paypay+=Number(e.paypay||0);a.waste+=Number(e.waste||0);return a},{increase:0,paypay:0,waste:0})}
function currentPending(filterDevice=()=>true){let sum=0;for(const d of db.devices.filter(filterDevice)){const list=entriesFor(d.id);sum+=Number(list.at(-1)?.pending||0)}return sum}
function normalDevices(){return db.devices.filter(d=>(d.type||'normal')!=='parent')}
function monthKey(){return dkey().slice(0,7)}
function monthlyCost(key=monthKey()){return Number(db.finance?.monthly?.[key]?.communicationCost??db.finance?.monthly?.[key]?.cost??0)}

function renderHome(){
  const today=dkey(),month=monthKey(),year=today.slice(0,4);
  const t=totals(e=>e.date===today),m=totals(e=>String(e.date).startsWith(month)),y=totals(e=>String(e.date).startsWith(year));
  $('todayPaypay').textContent=yen(t.paypay);$('todayIncrease').textContent=yen(t.increase);$('todayPending').textContent=yen(currentPending());
  const noSim=new Set(db.devices.filter(d=>String(d.sim||'').includes('なし')).map(d=>d.id));$('todaySim').textContent=`SIMなし ${yen(totals(e=>e.date===today&&noSim.has(e.deviceId)).paypay)}`;
  $('monthResult').textContent=yen(m.paypay-monthlyCost(month));
  const annualCost=Object.keys(db.finance?.monthly||{}).filter(k=>k.startsWith(year)).reduce((s,k)=>s+monthlyCost(k),0);
  $('yearResult').textContent=yen(y.paypay-annualCost-Number(db.finance?.initialInvestment||0));
  const ds=normalDevices();$('activeCount').textContent=ds.filter(d=>d.status==='active'||d.status==='稼働').length;$('waitingCount').textContent=ds.filter(d=>d.status==='waiting'||d.status==='待機').length;$('offCount').textContent=ds.filter(d=>!['active','稼働','waiting','待機'].includes(d.status)).length;$('deviceCount').textContent=ds.length;
  const recent=[...db.entries].sort((a,b)=>Number(b.timestamp||0)-Number(a.timestamp||0)).slice(0,6);
  $('recentList').className='list'+(recent.length?'':' empty');$('recentList').innerHTML=recent.length?recent.map(e=>`<div class="row"><div><b>${escapeHtml(db.devices.find(d=>d.id===e.deviceId)?.name||'削除済み')}</b><div class="sub">${e.date}・${escapeHtml(e.raw||'')}・増加 ${yen(e.increase)}</div></div><strong>${yen(e.paypay)}</strong></div>`).join(''):'入力はまだありません';
}
function renderDevices(){
  $('entryDevice').innerHTML='<option value="">端末を選択</option>'+normalDevices().map(d=>`<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  const ds=normalDevices();$('deviceList').className='list'+(ds.length?'':' empty');$('deviceList').innerHTML=ds.length?ds.map(d=>`<div class="row"><div><b>${escapeHtml(d.name)}</b><div class="sub">SIM ${escapeHtml(d.sim||'あり')}・${escapeHtml(d.status||'未稼働')}</div></div><button class="dangerbtn" data-delete-device="${d.id}">削除</button></div>`).join(''):'端末はまだありません';
}
function renderAnnual(){
  const month=$('annualMonth').value||monthKey(),q=String($('annualSearch').value||'').toLowerCase();const ds=normalDevices().filter(d=>String(d.name).toLowerCase().includes(q));
  let html='<table class="annual"><thead><tr><th>端末</th><th>増加</th><th>PayPay</th><th>捨て</th><th>月末未確定</th></tr></thead><tbody>';
  for(const d of ds){const list=entriesFor(d.id).filter(e=>String(e.date).startsWith(month));const t=list.reduce((a,e)=>{a.i+=Number(e.increase||0);a.p+=Number(e.paypay||0);a.w+=Number(e.waste||0);return a},{i:0,p:0,w:0});html+=`<tr><td>${escapeHtml(d.name)}</td><td>${yen(t.i)}</td><td>${yen(t.p)}</td><td>${yen(t.w)}</td><td>${yen(list.at(-1)?.pending||0)}</td></tr>`}
  $('annualTable').innerHTML=html+'</tbody></table>';
}
function renderSettings(){$('monthlyCost').value=monthlyCost();$('initialInvestment').value=Number(db.finance?.initialInvestment||0)}
function renderAll(){renderHome();renderDevices();renderAnnual();renderSettings()}
function go(page){document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===`page-${page}`));document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.go===page));if(page==='annual')renderAnnual();if(page==='settings')renderSettings();window.scrollTo(0,0)}
function escapeHtml(v){return String(v??'').replace(/[&<>"]/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]))}

function saveEntry(){
  try{const deviceId=$('entryDevice').value;if(!deviceId)throw new Error('端末を選んでください');const p=parseRaw($('entryRaw').value);const prev=Number(entriesFor(deviceId).at(-1)?.pending||0);const e={id:uid(),deviceId,date:dkey(),timestamp:Date.now(),operator:db.currentUser||'',...p,...calculate(prev,p)};e.inputRaw=e.raw;e.month=e.date.slice(0,7);e.year=e.date.slice(0,4);db.entries.push(e);persist();$('entryRaw').value='';renderAll();toast('端末へ保存しました');}
  catch(err){toast(err.message||'保存できませんでした')}
}
function addDevice(){const name=$('deviceName').value.trim();if(!name)return toast('端末名を入力してください');if(db.devices.some(d=>d.name===name))return toast('同じ端末名があります');db.devices.push({id:uid(),name,sim:$('deviceSim').value,status:'未稼働',type:'normal',createdAt:Date.now()});persist();$('deviceName').value='';renderAll();toast('端末を追加しました')}
function deleteDevice(id){const d=db.devices.find(x=>x.id===id);if(!d||!confirm(`${d.name}を削除しますか？\n入力履歴も削除されます。`))return;db.devices=db.devices.filter(x=>x.id!==id);db.entries=db.entries.filter(e=>e.deviceId!==id);persist();renderAll();toast('削除しました')}
function saveSettings(){const key=monthKey();db.finance.monthly[key]={...(db.finance.monthly[key]||{}),communicationCost:Number($('monthlyCost').value||0)};db.finance.initialInvestment=Number($('initialInvestment').value||0);persist();renderAll();toast('設定を保存しました')}
function exportBackup(){const payload={format:'D&D_TIKTOK_BACKUP',schemaVersion:BACKUP_SCHEMA_VERSION,appBuild:'26.0-local-stable',exportedAt:new Date().toISOString(),data:db};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`D&D_TikTok_backup_${dkey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('バックアップを書き出しました')}
async function restoreBackup(file){try{const parsed=JSON.parse(await file.text());const x=parsed?.format==='D&D_TIKTOK_BACKUP'?parsed.data:parsed;if(!x||!Array.isArray(x.devices)||!Array.isArray(x.entries))throw new Error('バックアップ形式が違います');if(!confirm(`端末 ${x.devices.length}台・履歴 ${x.entries.length}件を復元します。\n現在のデータは置き換わります。`))return;db=normalize(x);for(const d of db.devices)recalcDevice(d.id);persist();renderAll();toast('復元しました')}catch(err){toast(err.message||'復元できませんでした')}finally{$('restoreBackup').value=''}}

document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
document.querySelectorAll('[data-symbol]').forEach(b=>b.addEventListener('click',()=>{$('entryRaw').value+=b.dataset.symbol;$('entryRaw').focus()}));
$('saveEntry').addEventListener('click',saveEntry);$('addDevice').addEventListener('click',addDevice);$('saveSettings').addEventListener('click',saveSettings);$('exportBackup').addEventListener('click',exportBackup);$('restoreBackup').addEventListener('change',e=>e.target.files[0]&&restoreBackup(e.target.files[0]));$('annualMonth').addEventListener('change',renderAnnual);$('annualSearch').addEventListener('input',renderAnnual);$('deviceList').addEventListener('click',e=>{const id=e.target.dataset.deleteDevice;if(id)deleteDevice(id)});
$('todayLabel').textContent=new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'short'}).format(new Date());$('annualMonth').value=monthKey();renderAll();
