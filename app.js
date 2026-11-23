'use strict';
(function(){
const SB='https://tuherrvhmvajrtwavqmv.supabase.co';
const API=SB+'/functions/v1/inbox-api';
const KEY='standbyy.session';
const root=document.getElementById('app');
const S={session:null,revision:0,state:null,filter:'all',search:'',open:null,chat:null,pollTimer:null,sending:false};

// ---- small helpers
function h(tag,props,...kids){
  const e=document.createElement(tag);
  for(const k in (props||{})){
    const v=props[k];
    if(k==='class')e.className=v;
    else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);
    else if(v!==false&&v!=null)e.setAttribute(k,v===true?'':v);
  }
  for(const c of kids.flat())if(c!=null&&c!==false)e.append(c.nodeType?c:document.createTextNode(String(c)));
  return e;
}
function store(get,val){try{if(get)return localStorage.getItem(KEY);if(val==null)localStorage.removeItem(KEY);else localStorage.setItem(KEY,val)}catch(e){return null}}
function toast(t){const e=h('div',{class:'toast'},t);document.body.append(e);setTimeout(()=>e.remove(),2500)}
function uuid(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)})}
function ts(v){if(v==null)return null;if(typeof v==='number')return v>1e12?v:v*1000;const d=Date.parse(v);return isNaN(d)?null:d}
const tz='Asia/Bangkok';
function dayKey(ms){return new Date(ms).toLocaleDateString('en-CA',{timeZone:tz})}
function dayLabel(ms){const k=dayKey(ms);if(k===dayKey(Date.now()))return 'วันนี้';if(k===dayKey(Date.now()-864e5))return 'เมื่อวาน';return new Date(ms).toLocaleDateString('th-TH',{timeZone:tz,day:'numeric',month:'short',year:'numeric'})}
function hm(ms){return new Date(ms).toLocaleTimeString('th-TH',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false})}
function listTime(ms){if(ms==null)return '';return dayKey(ms)===dayKey(Date.now())?hm(ms):new Date(ms).toLocaleDateString('th-TH',{timeZone:tz,day:'numeric',month:'short'})}

// ---- session / network
function loadSession(){try{const s=JSON.parse(store(true)||'null');return s&&s.token&&s.publicKey?s:null}catch(e){return null}}
function saveSession(s){S.session=s;store(false,s?JSON.stringify(s):null)}
class ApiError extends Error{constructor(status,message){super(message);this.status=status}}
async function post(url,body,headers){
  let r;
  try{r=await fetch(url,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},headers||{}),body:JSON.stringify(body),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'})}
  catch(e){throw new ApiError(0,'ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต')}
  let data=null;try{data=await r.json()}catch(e){}
  if(!r.ok)throw new ApiError(r.status,(data&&(data.message||data.error))||('ผิดพลาด ('+r.status+')'));
  return data;
}
let refreshing=null;
async function ensureFresh(){
  const s=S.session;if(!s||!s.refreshToken||!s.tokenExpiresAt)return;
  if(s.tokenExpiresAt>Date.now()/1000+60)return;
  if(!refreshing)refreshing=post(API+'/v1/refresh',{refreshToken:s.refreshToken}).then(n=>{saveSession(Object.assign({},s,n))}).catch(e=>{if(e.status===401||e.status===400||e.status===403)throw new ApiError(401,'การเข้าสู่ระบบหมดอายุ');throw e}).finally(()=>{refreshing=null});
  await refreshing;
}
async function authed(fn){
  await ensureFresh();
  try{return await fn()}catch(e){if(e.status===401){logout(true);throw e}throw e}
}
function rpc(name,body){return authed(()=>post(SB+'/rest/v1/rpc/'+name,body,{apikey:S.session.publicKey,Authorization:'Bearer '+S.session.token}))}
function api(path,body){return authed(()=>post(API+path,body,{Authorization:'Bearer '+S.session.token}))}
function logout(expired){
  // Stop this phone's notifications first (needs the session), but never hold the user up for long.
  if(!expired&&S.session){Promise.race([pushOff(),new Promise(r=>setTimeout(r,4000))]).catch(()=>{}).finally(()=>logoutNow(false));return}
  logoutNow(expired);
}
function logoutNow(expired){
  clearInterval(S.pollTimer);S.pollTimer=null;saveSession(null);S.state=null;S.revision=0;S.open=null;S.chat=null;
  renderLogin(expired?'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่':'');
}

// ---- login
function renderLogin(msg){
  const id=h('input',{type:'text',placeholder:'ชื่อผู้ใช้',autocomplete:'username',autocapitalize:'none',autocorrect:'off',spellcheck:'false'});
  const pw=h('input',{type:'password',placeholder:'รหัสผ่าน',autocomplete:'current-password'});
  const err=h('div',{class:'note err',style:msg?'':'display:none'},msg||'');
  const btn=h('button',{type:'submit'},'เข้าสู่ระบบ');
  const form=h('form',{class:'login',onsubmit:async ev=>{
    ev.preventDefault();if(!id.value.trim()||!pw.value)return;
    btn.disabled=true;err.style.display='none';
    try{
      const r=await post(API+'/v1/login',{id:id.value.trim(),password:pw.value});
      pw.value='';
      saveSession(r);startApp();
    }catch(e){
      err.textContent=e.status===401?'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง':e.status===429?'ลองผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่':e.message;
      err.style.display='';btn.disabled=false;
    }
  }},h('h1',null,'Standby.y'),h('p',null,'กล่องข้อความลูกค้า สำหรับแอดมิน'),id,pw,err,btn);
  root.replaceChildren(form);
}

// ---- state polling
function conv(id){return S.state&&S.state.conversations.find(c=>c.id===id)}
function adminName(id){const a=S.state&&S.state.admins&&S.state.admins.find(x=>x.id===id);return a?a.name:id}
async function poll(force){
  try{
    const r=await rpc('inbox_poll_summary',{p_revision:force?0:S.revision});
    if(r.state){S.state=r.state;S.revision=r.revision}
    if(S.state&&r.waits)for(const c of S.state.conversations)if(r.waits[c.id]!=null)c.waiting_seconds=r.waits[c.id];
    if(S.open)updateChat();else renderList();
    updateTitle();
  }catch(e){if(e.status!==401)showNetErr(e)}
}
function showNetErr(e){const n=document.getElementById('neterr');if(n)n.textContent=e.message}
function totalUnread(){return S.state?S.state.conversations.reduce((n,c)=>n+(c.unread_count||0),0):0}
function updateTitle(){const n=totalUnread();document.title=n?'('+n+') Standby.y':'Standby.y'}
function startApp(){
  S.revision=0;S.state=null;S.open=null;renderList();poll(true);
  clearInterval(S.pollTimer);S.pollTimer=setInterval(()=>{if(!document.hidden)poll()},4500);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.session)poll()});

// ---- chat list
function lastMs(c){const m=c.messages&&c.messages[0];return ts(m&&m.created)||ts(c.last_inbound)}
function preview(m){
  if(!m)return '';
  if(m.kind==='image')return '📷 รูปภาพ';if(m.kind==='sticker')return 'สติกเกอร์';if(m.kind==='file')return '📎 '+(m.file_name||'ไฟล์');
  return (m.direction==='outbound'?'คุณ: ':'')+(m.body||'').replace(/\s+/g,' ');
}
function visibleList(){
  if(!S.state)return [];
  const me=S.session.id,q=S.search.trim().toLowerCase();
  return S.state.conversations.filter(c=>{
    if(S.filter==='mine'&&c.owner!==me)return false;
    if(S.filter==='waiting'&&c.status!=='waiting')return false;
    if(c.status==='closed'&&S.filter!=='all')return false;
    if(q&&!((c.customer||'').toLowerCase().includes(q)||((c.messages&&c.messages[0]&&c.messages[0].body)||'').toLowerCase().includes(q)))return false;
    return true;
  }).sort((a,b)=>(lastMs(b)||0)-(lastMs(a)||0));
}
let listEls=null;
function renderList(){
  const s=S.session;if(!s)return;
  if(!listEls||!root.contains(listEls.list)){
    const search=h('input',{type:'search',placeholder:'ค้นหาชื่อลูกค้า',value:S.search,oninput:e=>{S.search=e.target.value;fillList()}});
    const tabs=h('div',{class:'tabs'},[['all','ทั้งหมด'],['mine','ของฉัน'],['waiting','รอตอบ']].map(([k,t])=>h('button',{type:'button','data-k':k,onclick:()=>{S.filter=k;renderList()}},t)));
    const list=h('div',{class:'list'});
    const net=h('div',{class:'note err',id:'neterr',style:'display:none'});
    root.replaceChildren(
      h('div',{class:'bar'},h('h1',null,'แชทลูกค้า',h('small',null,(s.name||s.id)+' · v4')),h('button',{type:'button','aria-label':'แจ้งเตือน',onclick:openPushSheet},'🔔'),h('button',{type:'button',onclick:()=>{if(confirm('ออกจากระบบ?'))logout(false)}},'ออก')),
      tabs,h('div',{class:'search'},search),net,list);
    listEls={list,tabs,net};
  }
  for(const b of listEls.tabs.children)b.classList.toggle('on',b.dataset.k===S.filter);
  fillList();
}
function fillList(){
  const {list}=listEls;
  if(!S.state){list.replaceChildren(h('div',{class:'empty'},'กำลังโหลด…'));return}
  const items=visibleList();
  if(!items.length){list.replaceChildren(h('div',{class:'empty'},'ไม่มีแชท'));return}
  const top=list.scrollTop;
  list.replaceChildren(...items.map(c=>{
    const m=c.messages&&c.messages[0];
    const avatar=h('div',{class:'avatar'},(c.customer||'?').trim().charAt(0).toUpperCase());
    return h('button',{type:'button',class:'row',onclick:()=>openChat(c.id)},avatar,
      h('div',{class:'rowmain'},
        h('div',{class:'rowtop'},h('div',{class:'rowname'},c.customer||'ลูกค้า'),h('div',{class:'rowtime'},listTime(lastMs(c)))),
        h('div',{class:'rowbottom'},h('div',{class:'rowpreview'},preview(m)),
          c.status==='waiting'?h('span',{class:'chip wait'},'รอตอบ'):null,
          c.owner?h('span',{class:'chip'},c.owner===S.session.id?'ฉัน':adminName(c.owner)):null,
          c.unread_count?h('span',{class:'badge'},c.unread_count>99?'99+':c.unread_count):null)));
  }));
  list.scrollTop=top;
}

// ---- chat view
async function openChat(id){
  S.open=id;listEls=null;
  S.chat={id,messages:[],hasMore:false,loading:true,els:null};
  buildChat();
  try{
    const p=await rpc('inbox_message_page',{p_id:id});
    S.chat.messages=p.messages;S.chat.hasMore=p.has_more;S.chat.loading=false;
    drawMessages(true);markRead();
  }catch(e){if(S.chat)noteChat(e.message)}
}
function closeChat(){S.open=null;S.chat=null;renderList();poll(true)}
function buildChat(){
  const c=conv(S.open)||{};
  const ta=h('textarea',{rows:1,placeholder:'พิมพ์ข้อความ…',enterkeyhint:'enter',oninput:()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';refreshSend()}});
  const send=h('button',{type:'button',class:'send','aria-label':'ส่ง',onclick:()=>askSend()},'➤');
  const msgs=h('div',{class:'msgs'});
  const note=h('div',{class:'note',style:'display:none'});
  const comp=h('div',{class:'composer'},ta,send);
  S.chat.els={ta,send,msgs,note,comp,title:h('h1',null,c.customer||'แชท')};
  root.replaceChildren(h('div',{class:'bar'},h('button',{type:'button',class:'back','aria-label':'กลับ',onclick:closeChat},'‹'),S.chat.els.title),note,msgs,comp);
  refreshSend();
}
function sendBlock(){
  const c=conv(S.open);
  if(!S.state)return 'กำลังโหลด…';
  if(!S.state.lineSendingEnabled)return 'การส่งข้อความ LINE ปิดอยู่';
  if(!c)return 'ไม่พบแชท';
  if(c.status==='closed')return 'แชทนี้ปิดแล้ว';
  if(c.owner&&c.owner!==S.session.id)return 'แชทนี้เป็นของ '+adminName(c.owner)+' อ่านได้ แต่ส่งไม่ได้';
  return '';
}
function refreshSend(){
  const e=S.chat&&S.chat.els;if(!e)return;
  const why=sendBlock();
  e.send.disabled=!!why||S.sending||!e.ta.value.trim();
  e.ta.disabled=!!why&&why!=='กำลังโหลด…'&&false;
  if(why){e.note.textContent=why;e.note.style.display=''}else e.note.style.display='none';
}
function noteChat(t){const e=S.chat&&S.chat.els;if(e){e.note.textContent=t;e.note.className='note err';e.note.style.display=''}}
function updateChat(){
  const c=conv(S.open);
  if(c&&S.chat&&S.chat.els)S.chat.els.title.replaceChildren(c.customer||'แชท');
  refreshSend();
  if(!S.chat||S.chat.loading||S.chat.fetching)return;
  const last=S.chat.messages.length?S.chat.messages[S.chat.messages.length-1].sequence:0;
  const m=c&&c.messages&&c.messages[0];
  if(m&&m.sequence!=null&&m.sequence<=last&&(c.unread_count||0)===0)return;
  fetchNew();
}
async function fetchNew(){
  const ch=S.chat;if(!ch||ch.fetching)return;ch.fetching=true;
  try{
    for(let i=0;i<5;i++){
      const last=ch.messages.length?ch.messages[ch.messages.length-1].sequence:0;
      const p=await rpc('inbox_message_page',{p_id:ch.id,p_after:last});
      if(S.chat!==ch)return;
      if(!p.messages.length)break;
      const seen=new Set(ch.messages.map(x=>x.id));
      const fresh=p.messages.filter(x=>!seen.has(x.id));
      ch.messages.push(...fresh);
      drawMessages(false);
      if(!p.has_more)break;
    }
    markRead();
  }catch(e){}
  finally{ch.fetching=false}
}
let lastRead=null;
function markRead(){
  const c=conv(S.open);if(!c||!S.chat||!S.chat.messages.length)return;
  const cursor=S.chat.messages[S.chat.messages.length-1].sequence;
  if(!(c.unread_count>0)&&c.read_cursor!=null&&c.read_cursor>=cursor)return;
  if(lastRead===S.open+':'+cursor)return;lastRead=S.open+':'+cursor;
  api('/v1/read',{id:S.open,cursor}).then(()=>{c.unread_count=0;updateTitle()}).catch(()=>{lastRead=null});
}
// pictures: fetched with the session and kept as object addresses (the page never puts a token in an address)
const pics=new Map();
function loadPic(id,original){
  const k=id;if(pics.has(k))return pics.get(k);
  const p=authed(async()=>{
    const r=await fetch(API+'/v1/message-image?id='+encodeURIComponent(id),{headers:{Authorization:'Bearer '+S.session.token},cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
    if(!r.ok)throw new ApiError(r.status,'เปิดรูปไม่ได้');
    return URL.createObjectURL(await r.blob());
  }).catch(e=>{pics.delete(k);throw e});
  pics.set(k,p);return p;
}
function picNode(m){
  const img=h('img',{class:'pic',alt:'รูปภาพ',loading:'lazy'});
  const box=h('div',{class:'picbox'},img);
  const fail=()=>{box.replaceChildren(h('button',{type:'button',class:'older',onclick:()=>{pics.delete(m.id);box.replaceChildren(picNode(m))}},'รูปยังไม่พร้อม แตะเพื่อลองใหม่'))};
  if(m.media_id){loadPic(m.id).then(u=>{img.src=u;img.onclick=()=>viewPic(u)}).catch(fail)}
  else if(typeof m.body==='string'&&/^https:\/\//.test(m.body)){img.referrerPolicy='no-referrer';img.src=m.body;img.onclick=()=>viewPic(m.body);img.onerror=fail}
  else fail();
  return box;
}
function viewPic(src){
  const o=h('div',{class:'overlay viewer',onclick:()=>o.remove()},h('img',{src,alt:'รูปภาพ'}),h('button',{type:'button',class:'viewclose'},'✕'));
  document.body.append(o);
}
function stickerNode(m){
  const d=m.sticker_data||{};
  const id=String(d.stickerID||d.sticker_id||'');
  if(!/^[0-9]{1,20}$/.test(id))return h('div',{class:'bubble media'},'สติกเกอร์');
  return h('img',{class:'sticker',alt:'สติกเกอร์',referrerPolicy:'no-referrer',loading:'lazy',src:'https://stickershop.line-scdn.net/stickershop/v1/sticker/'+id+'/android/sticker.png'});
}
function jumpTo(id){
  const box=S.chat&&S.chat.els&&S.chat.els.msgs;
  const el=box&&box.querySelector('[data-mid="'+CSS.escape(id)+'"]');
  if(!el){toast('ข้อความนั้นเก่ากว่าที่โหลดไว้ กด "โหลดข้อความเก่ากว่า"');return}
  el.scrollIntoView({block:'center',behavior:'smooth'});
  el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),1600);
}
function bubble(m){
  const media=m.kind&&m.kind!=='text';
  const label=m.kind==='file'||m.kind==='file_unsupported'?'📎 '+(m.file_name||'ไฟล์'):m.kind==='video'?'🎬 วิดีโอ':m.kind==='audio'?'🎤 เสียง':null;
  const isPic=m.kind==='image'||m.kind==='line_image';
  const kids=[];
  if(m.reply_to){
    const t=S.chat&&S.chat.messages.find(x=>x.id===m.reply_to);
    const snip=t?(t.kind==='image'||t.kind==='line_image'?'📷 รูปภาพ':t.kind==='sticker'?'สติกเกอร์':(t.body||'')):'ข้อความที่ตอบกลับ';
    kids.push(h('button',{type:'button',class:'quote',onclick:()=>jumpTo(m.reply_to)},snip));
  }
  let main;
  if(isPic)main=picNode(m);
  else if(m.kind==='sticker')main=stickerNode(m);
  else main=h('div',{class:'bubble'+(media&&!m.body?' media':'')},m.body||label||'');
  const who=m.direction==='outbound'?(m.bot?h('span',{class:'bot'},'บอท · '):(m.sender?m.sender+' · ':'')):'';
  return h('div',{class:'msg '+(m.direction==='outbound'?'out':'in'),'data-mid':m.id},
    kids.length?h('div',{class:'bubble'},kids,main.className==='bubble'?main.textContent:main):main,
    h('div',{class:'meta'},who,hm(ts(m.created)||Date.now())));
}
function drawMessages(toBottom){
  const ch=S.chat;if(!ch||!ch.els)return;
  const box=ch.els.msgs;
  const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<120;
  const prevH=box.scrollHeight,prevTop=box.scrollTop;
  const nodes=[];
  if(ch.hasMore)nodes.push(h('button',{type:'button',class:'older',onclick:loadOlder},'โหลดข้อความเก่ากว่า'));
  let day=null;
  for(const m of ch.messages){
    const t=ts(m.created)||Date.now(),k=dayKey(t);
    if(k!==day){day=k;nodes.push(h('div',{class:'day'},dayLabel(t)))}
    nodes.push(bubble(m));
  }
  box.replaceChildren(...nodes);
  if(ch.keepOffset){box.scrollTop=box.scrollHeight-prevH+prevTop;ch.keepOffset=false}
  else if(toBottom||nearBottom)box.scrollTop=box.scrollHeight;
  else box.scrollTop=prevTop;
}
async function loadOlder(){
  const ch=S.chat;if(!ch||!ch.messages.length)return;
  try{
    const p=await rpc('inbox_message_page',{p_id:ch.id,p_before:ch.messages[0].sequence});
    if(S.chat!==ch)return;
    ch.messages=p.messages.concat(ch.messages);ch.hasMore=p.has_more;ch.keepOffset=true;drawMessages(false);
  }catch(e){toast(e.message)}
}

// ---- sending (always confirmed first)
function askSend(){
  const e=S.chat.els,body=e.ta.value.trim(),c=conv(S.open);
  if(!body||sendBlock()||S.sending)return;
  const requestID=uuid();
  const go=h('button',{type:'button',class:'go'},'ส่ง'),cancel=h('button',{type:'button'},'ยกเลิก');
  const overlay=h('div',{class:'overlay'},h('div',{class:'sheet'},
    h('h2',null,'ส่งถึง '+(c.customer||'ลูกค้า')+' ทาง LINE?'),h('div',{class:'text'},body),h('div',{class:'actions'},cancel,go)));
  cancel.onclick=()=>overlay.remove();
  go.onclick=async()=>{
    go.disabled=cancel.disabled=true;S.sending=true;
    try{
      await doSend(S.open,body,requestID);
      overlay.remove();
      if(S.chat&&S.chat.els){S.chat.els.ta.value='';S.chat.els.ta.style.height='auto'}
      toast('ส่งแล้ว');
      await poll(true);if(S.chat)fetchNew();
    }catch(err){
      overlay.remove();noteChat(err.message||'ส่งไม่สำเร็จ');
    }finally{S.sending=false;refreshSend()}
  };
  document.body.append(overlay);
}
async function doSend(id,body,requestID){
  const c=conv(id);
  const attempt=v=>api('/v1/send-line',{id,version:v,body,requestID,mobile:true});
  try{return await attempt(c.version)}
  catch(e){
    if(e.status!==409)throw e;
    await poll(true);const n=conv(id);
    if(!n||(n.owner&&n.owner!==S.session.id))throw new ApiError(409,'แชทเปลี่ยนไป กรุณาลองใหม่');
    return await attempt(n.version);
  }
}

// ---- notifications (Web Push, roadmap 6-5)
const standalone=()=>window.navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
const pushSupported=()=>'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
function b64uBytes(s){const p=s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4);return Uint8Array.from(atob(p),c=>c.charCodeAt(0))}
async function pushReg(){return navigator.serviceWorker.register('sw.js').then(()=>navigator.serviceWorker.ready)}
async function pushSub(){if(!pushSupported())return null;const reg=await navigator.serviceWorker.getRegistration();return reg?reg.pushManager.getSubscription():null}
async function pushOn(){
  if(await Notification.requestPermission()!=='granted')throw new Error('ยังไม่ได้อนุญาตการแจ้งเตือน ไปที่ ตั้งค่า › Standby.y › การแจ้งเตือน ของ iPhone');
  const reg=await pushReg();
  const {publicKey}=await api('/v1/push/key',{});
  let sub=await reg.pushManager.getSubscription();
  if(sub){const cur=sub.options&&sub.options.applicationServerKey;const want=b64uBytes(publicKey);
    if(!cur||cur.byteLength!==want.length||new Uint8Array(cur).some((v,i)=>v!==want[i])){await sub.unsubscribe();sub=null}}
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64uBytes(publicKey)});
  const j=sub.toJSON();
  await rpc('inbox_push_subscribe',{p_endpoint:j.endpoint,p_p256dh:j.keys.p256dh,p_auth:j.keys.auth});
}
async function pushOff(){
  const sub=await pushSub();if(!sub)return;
  const ep=sub.endpoint;await sub.unsubscribe();
  if(S.session)await rpc('inbox_push_unsubscribe',{p_endpoint:ep}).catch(()=>{});
}
async function openPushSheet(){
  const body=h('div',{class:'text'},'กำลังตรวจสอบ…');
  const actions=h('div',{class:'actions'});
  const close=h('button',{type:'button',onclick:()=>overlay.remove()},'ปิด');
  const overlay=h('div',{class:'overlay'},h('div',{class:'sheet'},h('h2',null,'แจ้งเตือนข้อความใหม่'),body,actions));
  document.body.append(overlay);
  const say=t=>body.textContent=t;
  async function draw(){
    actions.replaceChildren(close);
    if(!pushSupported()||!standalone()){say('iPhone ต้องเพิ่มเว็บนี้ไว้ที่หน้าจอโฮมก่อน: กดปุ่มแชร์ใน Safari แล้วเลือก "เพิ่มไปที่หน้าจอโฮม" จากนั้นเปิดจากไอคอนบนหน้าจอโฮม (ต้องใช้ iOS 16.4 ขึ้นไป)');return}
    const sub=await pushSub();
    if(sub&&Notification.permission==='granted'){
      say('เปิดแจ้งเตือนบนเครื่องนี้อยู่ จะแจ้งเมื่อลูกค้าส่งข้อความมาในแชทที่ยังว่างหรือเป็นของคุณ (ข้อความแจ้งเตือนไม่แสดงเนื้อหาแชท)');
      const test=h('button',{type:'button',onclick:async()=>{test.disabled=true;say('กำลังส่งแจ้งเตือนทดสอบ…');
        try{const r=await api('/v1/push/test',{});say('ส่งทดสอบแล้ว: '+r.devices+' เครื่อง, ผลจากบริการแจ้งเตือน '+(r.statuses.join(', ')||'-')+' (201 = รับแล้ว) ถ้าไม่เห็นแจ้งเตือนภายในไม่กี่วินาที แจ้งฉันพร้อมตัวเลขนี้')}
        catch(e){say(e.message)}test.disabled=false}},'ส่งแจ้งเตือนทดสอบ');
      const off=h('button',{type:'button',onclick:async()=>{try{await pushOff();draw()}catch(e){say(e.message)}}},'ปิดแจ้งเตือน');
      actions.replaceChildren(close,off,test);
    }else{
      say('ยังไม่ได้เปิดแจ้งเตือนบนเครื่องนี้');
      const on=h('button',{type:'button',class:'go',onclick:async()=>{on.disabled=true;
        try{await pushOn();draw()}catch(e){say(e.message);on.disabled=false}}},'เปิดแจ้งเตือน');
      actions.replaceChildren(close,on);
    }
  }
  draw().catch(e=>say(e.message));
}

// ---- start
S.session=loadSession();
if(S.session)startApp();else renderLogin('');
})();
