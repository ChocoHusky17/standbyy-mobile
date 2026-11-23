'use strict';
(function(){
const SB='https://tuherrvhmvajrtwavqmv.supabase.co';
const API=SB+'/functions/v1/inbox-api';
const KEY='standbyy.session';
const root=document.getElementById('app');
const S={team:null,teamUnread:0,teamTick:0,session:null,revision:0,state:null,filter:'all',search:'',open:null,chat:null,pollTimer:null,sending:false};

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
const TH_ERR={'Start your shift first':'ต้องเข้าเวรก่อน','Hand off waiting conversations before ending shift':'ส่งต่อแชทที่รอตอบก่อนออกเวร',
 'Choose an active on-duty admin or return to queue':'เลือกแอดมินที่เข้าเวรอยู่ หรือคืนเข้าคิวกลาง','Only assigned admin or owner can hand off this chat':'เฉพาะเจ้าของแชทหรือ owner เท่านั้นที่ส่งต่อได้',
 'Conversation unavailable or already assigned':'แชทนี้มีผู้ดูแลแล้ว','Action status changed; reload before saving':'สถานะเปลี่ยนจากเครื่องอื่น ลองอีกครั้ง'};
class ApiError extends Error{constructor(status,message){super(TH_ERR[message]||message);this.status=status}}
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
    if(S.team)updateTeam();else if(S.open)updateChat();else{renderList();if(S.teamTick++%3===0)teamPeek()}
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
    if(q&&!((c.customer||'').toLowerCase().includes(q)||((c.messages&&c.messages[0]&&c.messages[0].body)||'').toLowerCase().includes(q)||(S.hits&&S.hits.q===q&&S.hits.ids.has(c.id))))return false;
    return true;
  }).sort((a,b)=>(isPinned(b)-isPinned(a))||((lastMs(b)||0)-(lastMs(a)||0)));
}
function isPinned(c){return S.state&&Array.isArray(S.state.pinnedConversationIDs)&&S.state.pinnedConversationIDs.includes(c.id)?1:0}
function meAdmin(){return S.state&&S.state.admins&&S.state.admins.find(a=>a.id===S.session.id)}
const onDuty=()=>{const m=meAdmin();return !!(m&&m.on_duty)};

let searchTimer=null;
function serverSearch(){
  clearTimeout(searchTimer);const q=S.search.trim().toLowerCase();
  if(q.length<2){S.hits=null;return}
  searchTimer=setTimeout(async()=>{
    try{const ids=await rpc('inbox_search_messages',{p_query:S.search.trim()});
      if(S.search.trim().toLowerCase()===q){S.hits={q,ids:new Set(ids)};if(listEls&&!S.open&&!S.team)fillList()}}catch(e){}
  },400);
}
let listEls=null;
function renderList(){
  const s=S.session;if(!s)return;
  if(!listEls||!root.contains(listEls.list)){
    const search=h('input',{type:'search',placeholder:'ค้นหาชื่อลูกค้าหรือข้อความ',value:S.search,oninput:e=>{S.search=e.target.value;fillList();serverSearch()}});
    const tabs=h('div',{class:'tabs'},[['all','ทั้งหมด'],['mine','ของฉัน'],['waiting','รอตอบ']].map(([k,t])=>h('button',{type:'button','data-k':k,onclick:()=>{S.filter=k;renderList()}},t)).concat([h('button',{type:'button',id:'teamtab',onclick:openTeam},'ทีม',h('span',{class:'badge tb',style:S.teamUnread?'':'display:none'},String(S.teamUnread||'')))]));
    const list=h('div',{class:'list'});
    const net=h('div',{class:'note err',id:'neterr',style:'display:none'});
    root.replaceChildren(
      h('div',{class:'bar'},h('h1',null,'แชทลูกค้า',h('small',{id:'whoami'},(s.name||s.id)+' · v10')),h('button',{type:'button',id:'shiftbtn',onclick:toggleShift},'เวร'),h('button',{type:'button','aria-label':'แจ้งเตือน',onclick:openPushSheet},'🔔'),h('button',{type:'button',onclick:()=>{if(confirm('ออกจากระบบ?'))logout(false)}},'ออก')),
      tabs,h('div',{class:'search'},search),net,list);
    listEls={list,tabs,net};
  }
  for(const b of listEls.tabs.children)b.classList.toggle('on',b.dataset.k===S.filter);
  fillList();
}
function fillList(){
  const {list}=listEls;
  const sb=document.getElementById('shiftbtn');if(sb)sb.textContent=onDuty()?'🟢 เข้าเวร':'⚪ ออกเวร';
  if(!S.state){list.replaceChildren(h('div',{class:'empty'},'กำลังโหลด…'));return}
  const items=visibleList();
  if(!items.length){list.replaceChildren(h('div',{class:'empty'},'ไม่มีแชท'));return}
  const top=list.scrollTop;
  list.replaceChildren(...items.map(c=>{
    const m=c.messages&&c.messages[0];
    const avatar=h('div',{class:'avatar'},(c.customer||'?').trim().charAt(0).toUpperCase());
    return h('button',{type:'button',class:'row',onclick:()=>openChat(c.id)},avatar,
      h('div',{class:'rowmain'},
        h('div',{class:'rowtop'},h('div',{class:'rowname'},(isPinned(c)?'📌 ':'')+(c.customer||'ลูกค้า')),h('div',{class:'rowtime'},listTime(lastMs(c)))),
        h('div',{class:'rowbottom'},h('div',{class:'rowpreview'},preview(m)),
          c.status==='waiting'?h('span',{class:'chip wait'},'รอตอบ'):null,
          c.action_required?h('span',{class:'chip wait'},'⚑'):null,
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
  const file=h('input',{type:'file',accept:'image/*',style:'display:none',onchange:()=>{const f=file.files[0];file.value='';if(f)askSendImage(f)}});
  const attach=h('button',{type:'button',class:'attach','aria-label':'ส่งรูป',onclick:()=>{if(!sendBlock()&&!S.sending)file.click()}},'📷');
  const quick=h('button',{type:'button',class:'attach','aria-label':'ข้อความด่วน',onclick:()=>{if(!sendBlock())openQuick()}},'⚡');
  const comp=h('div',{class:'composer'},attach,quick,file,ta,send);
  S.chat.els={ta,send,msgs,note,comp,replybar:null,title:h('h1',null,c.customer||'แชท')};
  root.replaceChildren(h('div',{class:'bar'},h('button',{type:'button',class:'back','aria-label':'กลับ',onclick:closeChat},'‹'),S.chat.els.title,h('button',{type:'button',onclick:openOrders},'ออเดอร์'),h('button',{type:'button','aria-label':'เมนูแชท',onclick:openChatMenu},'⋯')),note,msgs,comp);
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
  const canQuote=m.direction==='inbound'&&m.quotable===true&&/^line:/.test(S.open||'');
  return h('div',{class:'msg '+(m.direction==='outbound'?'out':'in'),'data-mid':m.id},
    kids.length?h('div',{class:'bubble'},kids,main.className==='bubble'?main.textContent:main):main,
    h('div',{class:'meta'},who,hm(ts(m.created)||Date.now()),canQuote?h('button',{type:'button',class:'replybtn','aria-label':'ตอบข้อความนี้',onclick:()=>setReply(m)},' ↩ ตอบ'):null));
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

function snippetOf(m){return m.kind==='image'||m.kind==='line_image'?'📷 รูปภาพ':m.kind==='sticker'?'สติกเกอร์':(m.body||'').replace(/\s+/g,' ').slice(0,80)}
function setReply(m){
  if(sendBlock()){toast(sendBlock());return}
  S.chat.replyTo={id:m.id,snippet:snippetOf(m)};drawReplyBar();S.chat.els.ta.focus();
}
function drawReplyBar(){
  const e=S.chat&&S.chat.els;if(!e)return;
  const r=S.chat.replyTo;
  if(e.replybar){e.replybar.remove();e.replybar=null}
  if(!r)return;
  e.replybar=h('div',{class:'replybar'},h('span',null,'↩ ตอบ: '+r.snippet),h('button',{type:'button','aria-label':'ยกเลิกการตอบ',onclick:()=>{S.chat.replyTo=null;drawReplyBar()}},'✕'));
  e.comp.before(e.replybar);
}
// ---- quick texts (shop's and mine): tap one to put it in the message box
async function openQuick(){
  const body=h('div',{class:'ordersbody'},h('div',{class:'empty'},'กำลังโหลด…'));
  const overlay=h('div',{class:'overlay',onclick:ev=>{if(ev.target===overlay)overlay.remove()}},h('div',{class:'sheet tall'},h('h2',null,'ข้อความด่วน'),body,h('div',{class:'actions'},h('button',{type:'button',onclick:()=>overlay.remove()},'ปิด'))));
  document.body.append(overlay);
  try{
    const q=await rpc('inbox_quick_texts',{});
    const pick=t=>{const ta=S.chat&&S.chat.els&&S.chat.els.ta;if(ta){ta.value=(ta.value?ta.value+'\n':'')+t.body;ta.dispatchEvent(new Event('input'));ta.focus()}overlay.remove()};
    const group=(title,list)=>list&&list.length?[h('div',{class:'sub'},title),...list.map(t=>h('button',{type:'button',class:'menuitem',onclick:()=>pick(t)},h('div',null,t.label),h('div',{class:'qbody'},t.body)))]:[];
    const nodes=[...group('ของฉัน',q.mine),...group('ของร้าน',q.shop)];
    body.replaceChildren(...(nodes.length?nodes:[h('div',{class:'empty'},'ยังไม่มีข้อความด่วน (ตั้งค่าได้ในแอป Mac)')]));
  }catch(e){body.replaceChildren(h('div',{class:'empty'},e.message))}
}

// ---- sending (always confirmed first)
function askSend(){
  const e=S.chat.els,body=e.ta.value.trim(),c=conv(S.open);
  if(!body||sendBlock()||S.sending)return;
  const requestID=uuid(),reply=S.chat.replyTo;
  const go=h('button',{type:'button',class:'go'},'ส่ง'),cancel=h('button',{type:'button'},'ยกเลิก');
  const overlay=h('div',{class:'overlay'},h('div',{class:'sheet'},
    h('h2',null,'ส่งถึง '+(c.customer||'ลูกค้า')+' ทาง LINE?'),reply?h('div',{class:'quote'},'↩ ตอบ: '+reply.snippet):null,h('div',{class:'text'},body),h('div',{class:'actions'},cancel,go)));
  cancel.onclick=()=>overlay.remove();
  go.onclick=async()=>{
    go.disabled=cancel.disabled=true;S.sending=true;
    try{
      await doSend(S.open,body,requestID,null,reply&&reply.id);
      overlay.remove();
      if(S.chat&&S.chat.els){S.chat.els.ta.value='';S.chat.els.ta.style.height='auto';S.chat.replyTo=null;drawReplyBar()}
      toast('ส่งแล้ว');
      await poll(true);if(S.chat)fetchNew();
    }catch(err){
      overlay.remove();noteChat(err.message||'ส่งไม่สำเร็จ');
    }finally{S.sending=false;refreshSend()}
  };
  document.body.append(overlay);
}
async function doSend(id,body,requestID,mediaID,replyTo){
  const c=conv(id);
  const attempt=v=>api('/v1/send-line',Object.assign({id,version:v,requestID,mobile:true},mediaID?{mediaID}:Object.assign({body},replyTo?{replyTo}:{})));
  try{return await attempt(c.version)}
  catch(e){
    if(e.status!==409)throw e;
    await poll(true);const n=conv(id);
    if(!n||(n.owner&&n.owner!==S.session.id))throw new ApiError(409,'แชทเปลี่ยนไป กรุณาลองใหม่');
    return await attempt(n.version);
  }
}



// ---- sending a picture (always previewed and confirmed first)
async function shrink(file){
  let bmp;try{bmp=await createImageBitmap(file,{imageOrientation:'from-image'})}catch(e){throw new Error('เปิดรูปนี้ไม่ได้ ลองรูปแบบ JPEG หรือ PNG')}
  let max=1600,q=0.82;
  for(let i=0;i<8;i++){
    const k=Math.min(1,max/Math.max(bmp.width,bmp.height));
    const c=document.createElement('canvas');c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);
    const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(bmp,0,0,c.width,c.height);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',q));
    if(blob&&blob.size<=800000)return blob;
    max=Math.round(max*0.8);q=Math.max(0.6,q-0.05);
  }
  throw new Error('รูปใหญ่เกินไป ลองรูปอื่น');
}
function blobB64(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=()=>rej(new Error('อ่านรูปไม่ได้'));r.readAsDataURL(blob)})}
async function askSendImage(file,ready){
  const c=conv(S.open);if(!c||sendBlock()||S.sending)return;
  let blob;try{blob=ready?file:await shrink(file)}catch(e){noteChat(e.message);return}
  const url=URL.createObjectURL(blob),id=S.open,requestID=uuid();
  const go=h('button',{type:'button',class:'go'},'ส่ง'),cancel=h('button',{type:'button'},'ยกเลิก');
  const close=()=>{URL.revokeObjectURL(url);overlay.remove()};
  const overlay=h('div',{class:'overlay'},h('div',{class:'sheet'},h('h2',null,'ส่งรูปนี้ถึง '+(c.customer||'ลูกค้า')+' ทาง LINE?'),
    h('img',{class:'pic',src:url,alt:'รูปที่จะส่ง',style:'align-self:center'}),h('div',{class:'actions'},cancel,go)));
  cancel.onclick=close;
  go.onclick=async()=>{
    go.disabled=cancel.disabled=true;S.sending=true;
    try{
      const cur=conv(id);
      const up=await api('/v1/line-image',{id,version:cur.version,image:await blobB64(blob),mobile:true});
      await doSend(id,null,requestID,up.mediaID);
      close();toast('ส่งรูปแล้ว');await poll(true);if(S.chat)fetchNew();
    }catch(err){close();noteChat(err.message||'ส่งรูปไม่สำเร็จ')}
    finally{S.sending=false;refreshSend()}
  };
  document.body.append(overlay);
}

// ---- summary picture with the PromptPay QR (same layout as the Mac app; fonts come from the server after sign-in)
let fontsReady=null;
function loadFonts(){
  if(fontsReady)return fontsReady;
  const get=name=>authed(async()=>{const r=await fetch(API+'/v1/asset?name='+name,{headers:{Authorization:'Bearer '+S.session.token},cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
    if(!r.ok)throw new ApiError(r.status,'โหลดฟอนต์ไม่ได้');return r.arrayBuffer()});
  fontsReady=Promise.all([get('font-regular'),get('font-bold'),get('logo')]).then(async([reg,bold,logo])=>{
    const a=new FontFace('FCMinimal',reg),b=new FontFace('FCMinimalBold',bold);
    await Promise.all([a.load(),b.load()]);document.fonts.add(a);document.fonts.add(b);
    const img=new Image();const url=URL.createObjectURL(new Blob([logo],{type:'image/png'}));
    await new Promise((res,rej)=>{img.onload=res;img.onerror=()=>rej(new Error('โหลดโลโก้ไม่ได้'));img.src=url});
    return {logo:img};
  }).catch(e=>{fontsReady=null;throw e});
  return fontsReady;
}
const fillT=(t,v)=>Object.keys(v).reduce((a,k)=>a.split('{'+k+'}').join(v[k]),t);
const money2=n=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2});
const money0=n=>Math.round(Number(n||0)).toLocaleString('en-US');
function thaiLines(ctx,text,maxW){
  const out=[];
  for(const para of String(text).split('\n')){
    if(!para){out.push('');continue}
    const seg=typeof Intl!=='undefined'&&Intl.Segmenter?[...new Intl.Segmenter('th',{granularity:'word'}).segment(para)].map(x=>x.segment):[...para];
    let line='';
    for(const w of seg){
      if(ctx.measureText(line+w).width<=maxW||!line.trim()){line+=w}
      else{out.push(line.trimEnd());line=w.trimStart()}
    }
    out.push(line.trimEnd());
  }
  return out;
}
async function makeSummary(o,btn){
  btn.disabled=true;const old=btn.textContent;btn.textContent='กำลังสร้างรูป…';
  try{
    const [res,doc,tpl]=await Promise.all([loadFonts(),rpc('inbox_order_document',{p_order:o.id}),rpc('inbox_price_summary_settings',{})]);
    const blob=await drawSummary(res,doc,tpl,o);
    document.querySelector('.overlay')?.remove();
    await askSendImage(blob,true);
  }catch(e){btn.disabled=false;btn.textContent=old;toast(e.message||'สร้างรูปไม่ได้')}
}
function planned(v){if(!v||String(v).length<10)return 'รอยืนยัน';const p=String(v).slice(0,10).split('-');return p[2]+'/'+p[1]+'/'+p[0]}
async function drawSummary(res,doc,tpl,linked){
  const {shop,order}=doc;
  const WINE='#742923',CREAM='#fffaee',GRAY='#736b66',W=400,PAD=20,GAP=12,INNER=14,SCALE=2.7;
  const due=order.payment_status==='paid'?0:order.payment_status==='deposit'?Math.max(0,order.total-(order.deposit_amount||0)):order.total;
  // shipping / delivery / payment texts from the shop's templates
  const fee=money0(order.shipping_fee);
  const shipLabel={ems:'EMS',grab_normal:'Grab',grab_from_customer:'Grab (ลูกค้าเรียก)',pickup:'รับที่ร้าน'}[order.shipping_method]||'รอคอนเฟิร์ม';
  const shipText=fillT((tpl.shipping&&tpl.shipping[order.shipping_method])||shipLabel,{'ค่าส่ง':fee});
  const delivery=planned(linked.ship_by_planned);
  const vals={'จัดส่ง':'','ค่าส่ง':fee,'ยอดรวม':money0(order.total),'วันส่งงาน':delivery,'เลขออเดอร์':order.order_no,'รายการ':'','ส่วนลด':''};
  const after=(tpl.with_payment||'').split('{สรุปรายการ}').slice(1).join('');
  const payment=fillT(after,vals).trim();
  const paras=payment.split('\n\n');
  const account=(paras[0]||'').trim(),afterText=paras.slice(1).join('\n\n').trim();
  let qr=null;
  if(due>0&&shop.promptpay_payload){const pl=QR.promptPayPayload(shop.promptpay_payload,due);if(pl)qr=QR.encode(pl)}
  await Promise.all([document.fonts.load('10px FCMinimal','สรุป'),document.fonts.load('bold 10px FCMinimalBold','สรุป')]);
  const cv=document.createElement('canvas'),ctx=cv.getContext('2d');
  const F=(size,bold)=>(bold?'bold ':'')+(size*(size>30?1.5:1.25))+'px '+(bold?'FCMinimalBold':'FCMinimal')+',system-ui,sans-serif';
  const innerW=W-2*PAD-2*INNER;
  const EMO=/\p{Extended_Pictographic}/u;
  const lineH=(l,base)=>EMO.test(l)?base+5:base;
  const sumH=(ls,base)=>ls.reduce((n,l)=>n+lineH(l,base),0);
  // pass 1 measures, pass 2 draws: the same function with draw=false/true
  function layout(draw){
    let y=PAD;
    const text=(t,x,yy,size,bold,color,align)=>{ctx.font=F(size,bold);ctx.fillStyle=color;ctx.textAlign='left';ctx.textBaseline='alphabetic';
      const w=align?ctx.measureText(t).width:0;ctx.fillText(t,align==='right'?x-w:align==='center'?x-w/2:x,yy)};
    const card=(h)=>{if(draw){ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(PAD,y,W-2*PAD,h,12);ctx.fill()}};
    // header
    const logo=res.logo,lw=92,lh=lw*logo.height/logo.width;
    const customer=order.customer_display?'คุณ'+order.customer_display.replace(/คุณ/g,''):'';
    const headH=Math.max(lh,customer?52:40);
    if(draw){text('สรุปรายการ',PAD,y+22,20,true,WINE);text('ออเดอร์ '+order.order_no,PAD,y+38,9,false,GRAY);if(customer)text(customer,PAD,y+52,9,false,GRAY);
      ctx.drawImage(logo,W-PAD-lw,y+(headH-lh)/2,lw,lh)}
    y+=Math.max(headH,56)+GAP;
    // items
    const rowsH=[];let h1=INNER*2;
    for(const it of order.items){ctx.font=F(8.5,false);const sub=it.quantity+' ชิ้น × '+money2(it.unit_price)+' บาท'+(it.note?' • '+it.note:'');
      const subL=thaiLines(ctx,sub,innerW-70);ctx.font=F(10,true);const nameL=thaiLines(ctx,it.product+(it.size?' '+it.size:''),innerW-70);
      const hh=nameL.length*14+subL.length*12+7;rowsH.push({it,nameL,subL,hh});h1+=hh}
    const extra=[];
    if(order.shipping_fee>0)extra.push(['ค่าส่ง '+(shipLabel==='รอคอนเฟิร์ม'?'':shipLabel),money2(order.shipping_fee),false]);
    if(order.rush_fee>0)extra.push(['ค่างานเร่ง',money2(order.rush_fee),false]);
    if(order.discount_amount>0)extra.push(['ส่วนลด','−'+money2(order.discount_amount),false]);
    extra.push(['ยอดรวม',money2(order.total)+' บาท',true]);
    if(order.payment_status==='deposit'){extra.push(['ชำระมัดจำแล้ว','−'+money2(order.deposit_amount||0),false]);extra.push(['ยอดที่ต้องโอน',money2(due)+' บาท',true])}
    h1+=9+extra.reduce((n,e)=>n+(e[2]?19:15),0);
    card(h1);
    if(draw){let yy=y+INNER;
      for(const r of rowsH){let ly=yy+11;ctx.font=F(10,true);
        r.nameL.forEach(l=>{text(l,PAD+INNER,ly,10,true,'#000');ly+=14});
        r.subL.forEach(l=>{text(l,PAD+INNER,ly-1,8.5,false,GRAY);ly+=12});
        text(money2(r.it.line_total),W-PAD-INNER,yy+11,10,false,'#000','right');yy+=r.hh}
      ctx.strokeStyle='#ddd';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(PAD+INNER,yy+1);ctx.lineTo(W-PAD-INNER,yy+1);ctx.stroke();yy+=9;
      for(const [l,v,b] of extra){text(l,PAD+INNER,yy+(b?12:10),b?11:9.5,b,b?WINE:GRAY);text(v,W-PAD-INNER,yy+(b?12:10),b?13:9.5,b,b?WINE:'#000','right');yy+=b?19:15}}
    y+=h1+GAP;
    // shipping box
    const sh=[ '🚚 วิธีจัดส่งงาน : '+shipText,'🗓️ ส่งงาน : '+delivery ];
    ctx.font=F(10,false);const shL=sh.flatMap(t=>thaiLines(ctx,t,innerW));
    const h2=INNER*2+sumH(shL,14)-2;card(h2);
    if(draw){let ly=y+INNER;shL.forEach(l=>{ly+=lineH(l,14);text(l,PAD+INNER,ly-(EMO.test(l)?5:3),10,false,'#000')})}
    y+=h2+GAP;
    // payment box
    if(due>0&&qr){
      const qrSize=150,left=innerW-qrSize-12;
      ctx.font=F(16,false);const accL=thaiLines(ctx,account,left);const nm=shop.promptpay_name||'';
      const parts=accL.map(l=>({t:l,size:16,color:'#000',h:lineH(l,21)}));
      if(nm)parts.push({t:nm,size:13,color:GRAY,h:22,gap:4});
      parts.push({t:'รับเงินได้จากทุกธนาคาร',size:11.5,color:GRAY,h:17,gap:6});
      const leftH=parts.reduce((n,q)=>n+q.h+(q.gap||0),0),rightH=14+4+qrSize+4+20,contentH=Math.max(leftH,rightH);
      const h3=INNER*2+contentH;card(h3);
      if(draw){let ly=y+INNER+(contentH-leftH)/2;
        for(const q of parts){ly+=(q.gap||0)+q.h;text(q.t,PAD+INNER,ly-(q.h>q.size*1.25+3?6:5),q.size,false,q.color)}
        const qx=W-PAD-INNER-qrSize,top=y+INNER+(contentH-rightH)/2,qy=top+18,n=qr.length;
        text('สแกนจ่าย',qx+qrSize/2,top+10,9,true,WINE,'center');
        ctx.fillStyle='#fff';ctx.fillRect(qx,qy,qrSize,qrSize);ctx.fillStyle='#000';
        const mod=qrSize/(n+8);for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(qr[r][c])ctx.fillRect(qx+(c+4)*mod,qy+(r+4)*mod,mod+.4,mod+.4);
        text(money2(due)+' บาท',qx+qrSize/2,qy+qrSize+17,14,true,'#000','center')}
      y+=h3+GAP;
    }else if(due<=0){
      const h3=INNER*2-2;card(h3+8);if(draw)text('✓ ชำระครบแล้ว ขอบคุณค่ะ',W/2,y+INNER+8,11,true,'#2e7d32','center');y+=h3+8+GAP;
    }
    if(due>0){
      if(afterText){ctx.font=F(9.5,false);const l=thaiLines(ctx,afterText,innerW);const h4=INNER*2+sumH(l,13);card(h4);
        if(draw){let ly=y+INNER;l.forEach(t=>{ly+=lineH(t,13);text(t,PAD+INNER,ly-(EMO.test(t)?5:3),9.5,false,'#000')})}y+=h4+GAP}
      else if(!payment){ctx.font=F(8.5,false);const l=thaiLines(ctx,'หลังโอนแล้ว รบกวนส่งสลิปพร้อมชื่อผู้รับ เบอร์โทรศัพท์ และที่อยู่จัดส่งค่ะ',innerW);
        if(draw)l.forEach((t,i)=>text(t,W/2,y+10+i*12,8.5,false,GRAY,'center'));y+=l.length*12+GAP}
    }
    return y-GAP+PAD;
  }
  cv.width=Math.round(W*SCALE);cv.height=10;ctx.setTransform(SCALE,0,0,SCALE,0,0);
  const H=Math.ceil(layout(false));
  cv.width=Math.round(W*SCALE);cv.height=Math.round(H*SCALE);ctx.setTransform(SCALE,0,0,SCALE,0,0);
  ctx.fillStyle=CREAM;ctx.fillRect(0,0,W,H);layout(true);
  for(const q of [0.9,0.82,0.74]){const b=await new Promise(r=>cv.toBlob(r,'image/jpeg',q));if(b&&b.size<=800000)return b}
  throw new Error('รูปใหญ่เกินไป');
}

// ---- chat controls: shift, claim, release, hand off, action flag, pin (same rules as the Mac app)
async function toggleShift(){
  try{await api('/v1/shift',{onDuty:!onDuty()});await poll(true);toast(onDuty()?'เข้าเวรแล้ว':'ออกเวรแล้ว')}
  catch(e){toast(e.message)}
}
function openChatMenu(){
  const id=S.open;
  const overlay=h('div',{class:'overlay',onclick:ev=>{if(ev.target===overlay)overlay.remove()}});
  const sheet=h('div',{class:'sheet tall'});overlay.append(sheet);document.body.append(overlay);
  const run=async(fn,done)=>{try{await fn();await poll(true);if(done)toast(done);draw()}catch(e){toast(e.message)}};
  function draw(){
    const c=conv(id);if(!c){overlay.remove();return}
    const mine=c.owner===S.session.id,isOwnerRole=S.session.role==='owner';
    const ownerName=c.owner?adminName(c.owner):'ว่าง (คิวกลาง)';
    const btn=(t,fn,cls)=>h('button',{type:'button',class:'menuitem '+(cls||''),onclick:fn},t);
    const items=[h('h2',null,c.customer||'แชท'),
      h('div',{class:'kv'},h('span',null,'ผู้ดูแล'),h('b',null,ownerName)),
      h('div',{class:'kv'},h('span',null,'เวรของคุณ'),h('b',null,onDuty()?'เข้าเวรอยู่':'ไม่ได้เข้าเวร'))];
    if(!c.owner)items.push(btn('รับแชทนี้',()=>{
      if(!onDuty()&&!confirm('ต้องเข้าเวรก่อนรับแชท เข้าเวรและรับแชทนี้เลยไหม?'))return;
      run(async()=>{if(!onDuty())await api('/v1/shift',{onDuty:true});await api('/v1/claim',{id})},'รับแชทแล้ว')}));
    if(c.owner&&(mine||isOwnerRole))items.push(btn('ปล่อยแชท (คืนเข้าคิวกลาง)',()=>run(()=>api('/v1/release',{id}),'ปล่อยแชทแล้ว')));
    if(c.owner&&(mine||isOwnerRole)||(!c.owner&&false)){
      const others=(S.state.admins||[]).filter(a=>a.active&&a.on_duty&&a.id!==S.session.id);
      items.push(h('div',{class:'sub'},'ส่งต่อให้'));
      if(!others.length)items.push(h('div',{class:'empty small'},'ไม่มีแอดมินคนอื่นที่เข้าเวรอยู่'));
      others.forEach(a=>items.push(btn(a.name,()=>run(()=>api('/v1/handoff',{id,owner:a.id}),'ส่งต่อให้ '+a.name+' แล้ว'))));
    }
    items.push(btn(c.action_required?'⚑ ยกเลิกธง "ต้องดำเนินการ"':'⚑ ติดธง "ต้องดำเนินการ"',()=>run(()=>api('/v1/action-required',{id,required:!c.action_required,version:c.action_version||1}))));
    if(Array.isArray(S.state.pinnedConversationIDs))items.push(btn(isPinned(c)?'📌 เลิกปักหมุด':'📌 ปักหมุดแชทนี้',()=>run(()=>rpc('inbox_set_chat_pin',{p_id:id,p_pinned:!isPinned(c)}))));
    if(c.line_chat_url&&/^https:\/\/chat\.line\.biz\//.test(c.line_chat_url))items.push(h('a',{class:'menuitem',href:c.line_chat_url,target:'_blank',rel:'noopener noreferrer'},'เปิดแชทใน LINE Official Account'));
    items.push(h('div',{class:'actions'},h('button',{type:'button',onclick:()=>overlay.remove()},'ปิด')));
    sheet.replaceChildren(...items);
  }
  draw();
}

// ---- orders linked to this chat (read only; editing stays in the Mac app)
const baht=n=>Number(n||0).toLocaleString('th-TH',{minimumFractionDigits:0,maximumFractionDigits:2})+' บาท';
const STATUS={inquiry:'รอคอนเฟิร์ม',confirmed:'คอนเฟิร์มแล้ว',designing:'กำลังออกแบบ',design_approved:'อนุมัติแบบแล้ว',in_production:'กำลังผลิต',ready_to_ship:'พร้อมส่ง',shipped:'ส่งออกแล้ว',done:'จัดส่งเรียบร้อย',cancelled:'ยกเลิก'};
const SHIP={ems:'EMS',grab_normal:'Grab',grab_from_customer:'Grab (ลูกค้าเรียก)',pickup:'รับที่ร้าน'};
const PAY={paid:'ชำระเต็มแล้ว',deposit:'ชำระมัดจำแล้ว'};
function dateTh(v){if(!v)return '-';const d=Date.parse(String(v).slice(0,10)+'T00:00:00+07:00');return isNaN(d)?String(v):new Date(d).toLocaleDateString('th-TH',{timeZone:tz,day:'numeric',month:'short',year:'numeric'})}
function orderCard(o){
  const row=(k,v)=>h('div',{class:'kv'},h('span',null,k),h('b',null,v));
  return h('div',{class:'ocard'},
    h('div',{class:'otop'},h('b',null,o.order_no),h('span',{class:'chip'},STATUS[o.status]||'ไม่ทราบสถานะ')),
    row('ชำระเงิน',PAY[o.payment_status]||'ยังไม่ชำระ'),
    row('วันส่งของ',dateTh(o.needed_by_date)),
    row('จัดส่ง',(SHIP[o.shipping_method]||'รอคอนเฟิร์ม')+(o.tracking_no?' · '+o.tracking_no:'')),
    h('div',{class:'items'},(o.items||[]).map(i=>h('div',{class:'item'},h('span',null,i.product_name+' '+(i.size_label||'')+' × '+i.quantity),h('span',null,baht(i.line_total))))),
    o.discount_amount?row('ส่วนลด','-'+baht(o.discount_amount)):null,
    o.rush_fee?row('ค่างานด่วน',baht(o.rush_fee)):null,
    o.shipping_fee?row('ค่าส่ง',baht(o.shipping_fee)):null,
    row('รวม',baht(o.total)),
    h('button',{type:'button',class:'sumbtn',onclick:ev=>makeSummary(o,ev.target)},'สรุปรายการเป็นรูป + QR'));
}
async function openOrders(){
  const id=S.open;
  const body=h('div',{class:'ordersbody'},h('div',{class:'empty'},'กำลังโหลด…'));
  const overlay=h('div',{class:'overlay'},h('div',{class:'sheet tall'},h('h2',null,'ออเดอร์ของแชทนี้'),body,h('div',{class:'actions'},h('button',{type:'button',onclick:()=>overlay.remove()},'ปิด'))));
  document.body.append(overlay);
  try{
    const list=await rpc('inbox_linked_orders',{p_conversation:id});
    body.replaceChildren(...(list.length?list.map(orderCard):[h('div',{class:'empty'},'ยังไม่มีออเดอร์ที่ผูกกับแชทนี้')]));
  }catch(e){body.replaceChildren(h('div',{class:'empty'},e.message))}
}

// ---- team chat (same messages as the Mac app)
function mentionBody(m){
  // @names that were picked as mentions open that customer's chat
  const names=(m.mentions||[]).filter(x=>x&&x.name);
  if(!names.length)return m.body;
  const parts=[];let rest=m.body;
  while(rest){
    let best=null;
    for(const x of names){const i=rest.indexOf('@'+x.name);if(i>=0&&(!best||i<best.i))best={i,x}}
    if(!best){parts.push(rest);break}
    if(best.i)parts.push(rest.slice(0,best.i));
    const x=best.x;parts.push(h('button',{type:'button',class:'mention',onclick:()=>{closeTeam();openChat(x.conversation)}},'@'+x.name));
    rest=rest.slice(best.i+x.name.length+1);
  }
  return parts;
}
async function teamPeek(){
  try{const f=await rpc('inbox_team_messages',{p_after:2147483647});S.teamUnread=f.unread||0;
    const b=document.querySelector('#teamtab .tb');if(b){b.textContent=String(S.teamUnread);b.style.display=S.teamUnread?'':'none'}}catch(e){}
}
function openTeam(){
  S.team={messages:[],lastRead:0,els:null,sending:false};
  const ta=h('textarea',{rows:1,placeholder:'พิมพ์ถึงทีม…',oninput:()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';send.disabled=!ta.value.trim()}});
  const send=h('button',{type:'button',class:'send','aria-label':'ส่ง',disabled:true,onclick:sendTeam},'➤');
  const msgs=h('div',{class:'msgs'});
  const note=h('div',{class:'note err',style:'display:none'});
  S.team.els={ta,send,msgs,note};
  root.replaceChildren(h('div',{class:'bar'},h('button',{type:'button',class:'back','aria-label':'กลับ',onclick:closeTeam},'‹'),h('h1',null,'แชททีมแอดมิน')),note,msgs,h('div',{class:'composer'},ta,send));
  listEls=null;updateTeam(true);
}
function closeTeam(){S.team=null;renderList();poll(true)}
async function updateTeam(first){
  const t=S.team;if(!t||t.busy)return;t.busy=true;
  try{
    const after=t.messages.length?t.messages[t.messages.length-1].id:0;
    const f=await rpc('inbox_team_messages',{p_after:after});
    if(S.team!==t)return;
    const seen=new Set(t.messages.map(m=>m.id));
    const fresh=f.messages.filter(m=>!seen.has(m.id)).sort((a,b)=>a.id-b.id);
    t.lastRead=f.last_read||0;
    if(fresh.length||first){t.messages.push(...fresh);drawTeam(first)}
    const last=t.messages.length?t.messages[t.messages.length-1].id:0;
    if(last>t.lastRead&&!document.hidden){t.lastRead=last;rpc('inbox_team_read',{p_last:last}).then(()=>{S.teamUnread=0}).catch(()=>{})}
  }catch(e){if(S.team===t&&e.status!==401){t.els.note.textContent=e.message;t.els.note.style.display=''}}
  finally{t.busy=false}
}
function drawTeam(toBottom){
  const t=S.team;if(!t)return;const box=t.els.msgs;
  const near=box.scrollHeight-box.scrollTop-box.clientHeight<120;
  const nodes=[];let day=null;
  for(const m of t.messages){
    const ms=m.created*1000,k=dayKey(ms);
    if(k!==day){day=k;nodes.push(h('div',{class:'day'},dayLabel(ms)))}
    const mine=m.author===S.session.id;
    nodes.push(h('div',{class:'msg '+(mine?'out':'in')},
      h('div',{class:'bubble'},m.conversation?h('button',{type:'button',class:'quote',onclick:()=>{closeTeam();openChat(m.conversation)}},'🗂 เคส: '+(m.customer||'ลูกค้า')):null,mentionBody(m)),
      h('div',{class:'meta'},(mine?'':m.author_name+' · ')+hm(ms))));
  }
  if(!nodes.length)nodes.push(h('div',{class:'empty'},'ยังไม่มีข้อความ'));
  box.replaceChildren(...nodes);
  if(toBottom||near)box.scrollTop=box.scrollHeight;
}
async function sendTeam(){
  const t=S.team;if(!t||t.sending)return;const body=t.els.ta.value.trim();if(!body)return;
  t.sending=true;t.els.send.disabled=true;
  try{
    await rpc('inbox_team_send',{p_body:body,p_conversation:null,p_mentions:[]});
    t.els.ta.value='';t.els.ta.style.height='auto';await updateTeam();
    t.els.msgs.scrollTop=t.els.msgs.scrollHeight;
  }catch(e){t.els.note.textContent=e.message;t.els.note.style.display=''}
  finally{t.sending=false;t.els.send.disabled=!t.els.ta.value.trim()}
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
