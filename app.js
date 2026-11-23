'use strict';
(function(){
const SB='https://tuherrvhmvajrtwavqmv.supabase.co';
const API=SB+'/functions/v1/inbox-api';
const KEY='standbyy.session';
const root=document.getElementById('app');
const S={section:'inbox',ph:null,waitOnly:false,ord:null,team:null,teamUnread:0,teamTick:0,session:null,revision:0,state:null,filter:'all',search:'',open:null,chat:null,pollTimer:null,sending:false};

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
  try{Object.keys(localStorage).filter(k=>k.startsWith('standbyy.cdraft.')||k.startsWith('standbyy.draft.')).forEach(k=>localStorage.removeItem(k))}catch(e){}
  nav.reset();
  clearInterval(S.pollTimer);S.pollTimer=null;saveSession(null);S.state=null;S.revision=0;S.open=null;S.chat=null;
  renderLogin(expired?'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่':'');
}

let S_failCount=0;

function logoImg(){return h('img',{class:'brand',src:'logo-mark.png',alt:'Standby.y',width:32,height:32})}
// ---- history: the phone's back button / edge swipe closes the top layer or screen
const nav={stack:[],ignore:0,lock:false,pending:[],
  push(close,el){
    if(nav.lock){nav.pending.push([close,el]);return}
    try{history.pushState({n:1},'')}catch(e){}
    nav.stack.push({close,el});
  },
  travel(n){nav.ignore++;nav.lock=true;history.go(n)},
  back(fallback){if(nav.stack.length)history.back();else if(fallback)fallback()},
  reset(){const n=nav.stack.length;nav.stack=[];if(n)nav.travel(-n)},
  drop(el){
    const i=nav.stack.findIndex(e=>e.el===el);if(i<0)return;
    if(i===nav.stack.length-1){nav.stack.pop();nav.travel(-1)}else nav.stack.splice(i,1);
  }};
try{history.replaceState({root:1},'')}catch(e){}
window.addEventListener('popstate',()=>{
  if(nav.ignore>0){nav.ignore--;if(nav.ignore===0){nav.lock=false;const q=nav.pending;nav.pending=[];q.forEach(([c,e])=>nav.push(c,e))}return}
  const e=nav.stack.pop();if(e)e.close();
});
new MutationObserver(ms=>ms.forEach(m=>{
  m.addedNodes.forEach(n=>{if(n.classList&&n.classList.contains('overlay')&&!n.__nav){n.__nav=1;nav.push(()=>n.remove(),n)}});
  m.removedNodes.forEach(n=>{if(n.__nav)nav.drop(n)});
})).observe(document.body,{childList:true});

// ---- running version, update banner, offline banner, pull to refresh
const RUNNING=((([...document.scripts].find(x=>/app\.js/.test(x.src))||{}).src||'').match(/[?&]v=(\d+)/)||[])[1]||'0';
function banner(id,cls,text,onclick){
  let b=document.getElementById(id);
  if(!text){if(b)b.remove();return}
  if(!b){b=h('button',{type:'button',id,class:'sysbanner '+cls});document.body.append(b)}
  b.textContent=text;b.onclick=onclick||null;
}
async function checkUpdate(){
  try{
    const r=await fetch('index.html?c='+Date.now(),{cache:'no-store',credentials:'omit'});if(!r.ok)return;
    const v=((await r.text()).match(/app\.js\?v=(\d+)/)||[])[1];
    if(v&&Number(v)>Number(RUNNING))banner('updbar','upd','มีเวอร์ชันใหม่ · แตะเพื่ออัปเดต',()=>{location.replace(location.pathname+'?u='+Date.now())});
  }catch(e){}
}
setInterval(()=>{if(!document.hidden)checkUpdate()},5*60*1000);
function netState(ok){
  if(ok)S_failCount=0;else S_failCount++;
  const off=(typeof navigator.onLine==='boolean'&&!navigator.onLine)||S_failCount>=2;
  banner('netbar','net',off?'เชื่อมต่อไม่ได้ · แตะเพื่อลองใหม่':'',()=>{poll(true)});
}
window.addEventListener('online',()=>poll(true));window.addEventListener('offline',()=>netState(false));
function pullRefresh(el,fn){
  let y0=null,dy=0;
  el.addEventListener('touchstart',e=>{y0=el.scrollTop<=0?e.touches[0].clientY:null;dy=0},{passive:true});
  el.addEventListener('touchmove',e=>{if(y0==null)return;dy=e.touches[0].clientY-y0;el.classList.toggle('pulling',dy>70)},{passive:true});
  el.addEventListener('touchend',()=>{el.classList.remove('pulling');if(y0!=null&&dy>70){toast('กำลังรีเฟรช…');fn()}y0=null;dy=0});
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
    if(S.team)updateTeam();else if(S.ord||S.ph){}else if(S.open)updateChat();else{renderList();if(S.teamTick++%3===0)teamPeek()}
    updateTitle();netState(true);notifJump();
  }catch(e){if(e.status!==401){showNetErr(e);netState(false)}}
}
// Tapping a push notification: if exactly one chat has something new for me (mine or free), open it.
function notifJump(){
  if(!S.notifJump||!S.state)return;
  if(Date.now()-S.notifJump>20000){S.notifJump=0;return}
  const want=S.notifChat;
  if(want){
    if(conv(want)){S.notifJump=0;S.notifChat='';if(S.open!==want){S.team=null;S.ord=null;S.ph=null;openChat(want)}}
    return;
  }
  S.notifJump=0;
  const me=S.session.id;
  const c=S.state.conversations.filter(x=>(x.unread_count||0)>0&&(!x.owner||x.owner===me));
  if(c.length===1&&S.open!==c[0].id){S.team=null;S.ord=null;S.ph=null;openChat(c[0].id)}
}
try{
  if(location.search.includes('n=1')){S.notifJump=Date.now();const m=location.search.match(/[?&]chat=([^&]+)/);if(m)S.notifChat=decodeURIComponent(m[1])}
  if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',e=>{if(e.data&&e.data.type==='notif'){S.notifJump=Date.now();S.notifChat=e.data.chat||'';if(S.session)poll(true)}});
}catch(e){}
function showNetErr(e){const n=document.getElementById('neterr');if(n)n.textContent=e.message}
function totalUnread(){return S.state?S.state.conversations.reduce((n,c)=>n+(c.unread_count||0),0):0}
function updateTitle(){const n=totalUnread();document.title=n?'('+n+') Standby.y':'Standby.y'}
function startApp(){
  S.revision=0;S.state=null;S.open=null;renderList();poll(true);checkUpdate();
  clearInterval(S.pollTimer);S.pollTimer=setInterval(()=>{if(!document.hidden)poll()},4500);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.session){poll();checkUpdate()}});

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
    if(S.section==='mine'&&c.owner!==me)return false;
    if(S.waitOnly&&c.status!=='waiting')return false;
    if(c.status==='closed'&&S.section==='mine')return false;
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

// ---- main menu (same items and order as the Mac app's sidebar)
const MENU=[['inbox','💬','กล่องข้อความ'],['mine','👤','ข้อความของฉัน'],['orders','📦','รายการออเดอร์'],['catalog','🏷️','สินค้าและราคา'],['portfolio','🖼️','คลังผลงาน'],['team','👥','ทีมแอดมิน'],['settings','⚙️','ตั้งค่า']];
function unreadFor(k){
  if(!S.state)return k==='team'?S.teamUnread:0;
  if(k==='team')return S.teamUnread||0;
  if(k!=='inbox'&&k!=='mine')return 0;
  return S.state.conversations.filter(c=>k==='inbox'||c.owner===S.session.id).reduce((n,c)=>n+Math.max(0,c.unread_count||0),0);
}
function menuTabs(active){
  return h('div',{class:'tabs scroll menu'},MENU.map(([k,icon,t])=>{
    const n=unreadFor(k);
    return h('button',{type:'button','data-k':k,class:active===k?'on':'',onclick:()=>goSection(k)},icon+' '+t,h('span',{class:'badge tb','data-badge':k,style:n?'':'display:none'},n>999?'999+':String(n)));
  }));
}
function refreshBadges(){
  document.querySelectorAll('[data-badge]').forEach(b=>{const n=unreadFor(b.dataset.badge);b.textContent=n>999?'999+':String(n);b.style.display=n?'':'none'});
}
function goSection(k){
  if(S.open&&S.chat&&S.chat.els)saveDraft(S.open,S.chat.els.ta.value);
  nav.reset();
  S.team=null;S.ord=null;S.ph=null;S.open=null;S.chat=null;listEls=null;
  if(k==='inbox'||k==='mine'){S.section=k;renderList();poll(true)}
  else if(k==='orders')openOrdersTab();
  else if(k==='team')openTeam();
  else if(k==='catalog')openCatalog();
  else if(k==='portfolio')openPortfolio();
  else openPlaceholder(k);
}
const PLACEHOLDER={settings:['ตั้งค่า','โปรไฟล์ เปลี่ยนรหัสผ่าน และตั้งค่าร้าน']};
function openPlaceholder(k){
  S.ph=k;const [title,desc]=PLACEHOLDER[k]||[k,''];
  root.replaceChildren(h('div',{class:'bar'},logoImg(),h('h1',null,title)),menuTabs(k),h('div',{class:'empty'},desc+' — กำลังเตรียมบนมือถือ ใช้ในแอป Mac ไปก่อน'));
}
let listEls=null;
function renderList(){
  const s=S.session;if(!s)return;
  if(!listEls||!root.contains(listEls.list)){
    const search=h('input',{type:'search',placeholder:'ค้นหาชื่อลูกค้าหรือข้อความ',value:S.search,oninput:e=>{S.search=e.target.value;fillList();serverSearch()}});
    const tabs=menuTabs(S.section);
    const wait=h('button',{type:'button',class:'waitbtn'+(S.waitOnly?' on':''),onclick:()=>{S.waitOnly=!S.waitOnly;wait.classList.toggle('on',S.waitOnly);fillList()}},'รอตอบ');
    const list=h('div',{class:'list'});
    const net=h('div',{class:'note err',id:'neterr',style:'display:none'});
    root.replaceChildren(
      h('div',{class:'bar'},logoImg(),h('h1',null,S.section==='mine'?'ข้อความของฉัน':'กล่องข้อความ',h('small',{id:'whoami'},(s.name||s.id)+' · v'+RUNNING)),h('button',{type:'button',id:'shiftbtn',onclick:toggleShift},'เวร'),h('button',{type:'button','aria-label':'แจ้งเตือน',onclick:openPushSheet},'🔔'),h('button',{type:'button',onclick:()=>{if(confirm('ออกจากระบบ?'))logout(false)}},'ออก')),
      tabs,h('div',{class:'search'},search,wait),net,list);
    listEls={list,tabs,net};pullRefresh(list,()=>poll(true));
  }
  fillList();
  if(S.restoreScroll){S.restoreScroll=false;listEls.list.scrollTop=S.listScroll||0}
}
function fillList(){
  const {list}=listEls;
  refreshBadges();
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
  if(listEls&&listEls.list)S.listScroll=listEls.list.scrollTop;
  if(nav.stack.length)nav.reset();
  nav.push(closeChatNow,null);
  S.open=id;listEls=null;
  S.chat={id,messages:[],hasMore:false,loading:true,els:null};
  buildChat();
  try{
    const p=await rpc('inbox_message_page',{p_id:id});
    S.chat.messages=p.messages;S.chat.hasMore=p.has_more;S.chat.loading=false;
    // The first message I have not read yet gets a divider and the chat opens there.
    const c=conv(id),unread=c?c.unread_count||0:0;
    if(unread>0){const inb=p.messages.filter(m=>m.direction==='inbound');
      const first=unread>=inb.length?inb[0]:inb[inb.length-unread];if(first&&unread<=inb.length)S.chat.unreadFromId=first.id}
    drawMessages(true);markRead();
  }catch(e){if(S.chat)noteChat(e.message)}
}
function closeChatNow(){
  if(S.chat&&S.chat.els)saveDraft(S.open,S.chat.els.ta.value);
  S.open=null;S.chat=null;S.ord=null;S.restoreScroll=true;renderList();poll(true);
}
function closeChat(){nav.back(closeChatNow)}
// unsent text is kept per chat on this phone
const DRAFT='standbyy.cdraft.';
function loadDraft(id){try{return localStorage.getItem(DRAFT+id)||''}catch(e){return ''}}
function saveDraft(id,text){try{if(text)localStorage.setItem(DRAFT+id,text);else localStorage.removeItem(DRAFT+id)}catch(e){}}
function buildChat(){
  const c=conv(S.open)||{};
  const ta=h('textarea',{rows:1,placeholder:'พิมพ์ข้อความ…',enterkeyhint:'enter',oninput:()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';refreshSend()}});
  const send=h('button',{type:'button',class:'send','aria-label':'ส่ง',onclick:()=>askSend()},'➤');
  const msgs=h('div',{class:'msgs'});
  const note=h('div',{class:'note',style:'display:none'});
  const file=h('input',{type:'file',accept:'image/*',style:'display:none',onchange:()=>{const f=file.files[0];file.value='';if(f)askSendImage(f)}});
  const plus=h('button',{type:'button',class:'attach plus','aria-label':'เพิ่ม',onclick:()=>{
    if(sendBlock()){toast(sendBlock());return}
    const overlay=h('div',{class:'overlay',onclick:ev=>{if(ev.target===overlay)overlay.remove()}});
    const item=(icon,text,fn)=>h('button',{type:'button',class:'menuitem',onclick:()=>{overlay.remove();fn()}},icon+'  '+text);
    overlay.append(h('div',{class:'sheet'},
      item('📷','ส่งรูปจากเครื่อง',()=>{if(!S.sending)file.click()}),
      item('🖼️','คลังผลงานและตารางราคา',()=>openPortfolio(true)),
      item('⚡','ข้อความด่วน',openQuick),
      item('✨','ร่างคำตอบด้วย AI',askAI),
      h('div',{class:'actions'},h('button',{type:'button',onclick:()=>overlay.remove()},'ยกเลิก'))));
    document.body.append(overlay);
  }},'＋');
  const comp=h('div',{class:'composer'},plus,file,ta,send);
  ta.value=loadDraft(S.open);
  ta.addEventListener('input',()=>saveDraft(S.open,ta.value));
  S.chat.els={ta,send,msgs,note,comp,replybar:null,title:h('h1',null,c.customer||'แชท')};
  const down=h('button',{type:'button',class:'downbtn','aria-label':'เลื่อนลงข้อความล่าสุด',onclick:()=>{msgs.scrollTo({top:msgs.scrollHeight,behavior:'smooth'})}},'↓',h('span',{class:'dcount'}));
  S.chat.els.down=down;
  const wrap=h('div',{class:'chatwrap'},msgs,down);
  msgs.addEventListener('scroll',()=>{
    const far=msgs.scrollHeight-msgs.scrollTop-msgs.clientHeight>240;
    down.classList.toggle('show',far);
    if(!far&&S.chat){S.chat.newBelow=0;down.querySelector('.dcount').textContent=''}
  },{passive:true});
  root.replaceChildren(h('div',{class:'bar'},h('button',{type:'button',class:'back','aria-label':'กลับ',onclick:closeChat},'‹'),S.chat.els.title,h('button',{type:'button',onclick:openChatOrders},'ออเดอร์'),h('button',{type:'button','aria-label':'เมนูแชท',onclick:openChatMenu},'⋯')),note,wrap,comp);
  refreshSend();
  if(ta.value){ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px'}
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
  else if((m.kind==='file')&&m.media_id)main=h('button',{type:'button',class:'bubble filebtn',onclick:ev=>downloadFile(m,ev.currentTarget)},'📎 '+(m.file_name||'ไฟล์')+' · แตะเพื่อเปิด');
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
    if(ch.unreadFromId&&m.id===ch.unreadFromId)nodes.push(h('div',{class:'day newdiv',id:'newdiv'},'ข้อความใหม่'));
    nodes.push(bubble(m));
  }
  box.replaceChildren(...nodes);
  if(ch.keepOffset){box.scrollTop=box.scrollHeight-prevH+prevTop;ch.keepOffset=false}
  else if(toBottom&&ch.unreadFromId&&!ch.jumped&&document.getElementById('newdiv')){ch.jumped=true;box.scrollTop=Math.max(0,document.getElementById('newdiv').offsetTop-70)}
  else if(toBottom||nearBottom)box.scrollTop=box.scrollHeight;
  else{box.scrollTop=prevTop;
    if(ch.lastCount!=null&&ch.messages.length>ch.lastCount&&ch.els&&ch.els.down){ch.newBelow=(ch.newBelow||0)+(ch.messages.length-ch.lastCount);const dc=ch.els.down.querySelector('.dcount');dc.textContent=String(ch.newBelow);ch.els.down.classList.add('show')}}
  ch.lastCount=ch.messages.length;
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
      if(S.chat&&S.chat.els){S.chat.els.ta.value='';saveDraft(S.open,'');S.chat.els.ta.style.height='auto';S.chat.replyTo=null;drawReplyBar()}
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
async function askSendImage(file,ready,after){
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
      close();toast('ส่งรูปแล้ว');if(after)after();await poll(true);if(S.chat)fetchNew();
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

// ---- files
async function downloadFile(m,btn){
  const old=btn.textContent;btn.disabled=true;btn.textContent='กำลังโหลด…';
  try{
    const blob=await authed(async()=>{const r=await fetch(API+'/v1/message-file?id='+encodeURIComponent(m.id),{headers:{Authorization:'Bearer '+S.session.token},cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
      if(!r.ok)throw new ApiError(r.status,'ไฟล์ยังไม่พร้อมหรือเปิดไม่ได้');return r.blob()});
    fileSheet(m,blob);
  }catch(e){toast(e.message)}
  finally{btn.disabled=false;btn.textContent=old}
}
// A file never replaces the app's own page (the home-screen app has no back button): view it in a layer with a close button, or share/save it.
function fileSheet(m,blob){
  const name=m.file_name||'file',url=URL.createObjectURL(blob);
  const done=()=>{URL.revokeObjectURL(url);overlay.remove()};
  const view=h('button',{type:'button',class:'go'},'เปิดดู');
  const share=h('button',{type:'button'},'แชร์ / บันทึก');
  const close=h('button',{type:'button'},'ปิด');
  const overlay=h('div',{class:'overlay'},h('div',{class:'sheet'},h('h2',null,'📎 '+name),h('div',{class:'meta'},Math.round(blob.size/1024)+' KB'),h('div',{class:'actions'},close,share,view)));
  close.onclick=done;
  view.onclick=()=>{
    const layer=h('div',{class:'overlay viewer filelayer'},
      /^image\//.test(blob.type)?h('img',{src:url,alt:name}):h('iframe',{src:url,title:name}),
      h('button',{type:'button',class:'viewclose',onclick:()=>layer.remove()},'✕'));
    document.body.append(layer);
  };
  share.onclick=async()=>{
    try{
      const f=new File([blob],name,{type:blob.type||'application/octet-stream'});
      if(navigator.canShare&&navigator.canShare({files:[f]}))await navigator.share({files:[f],title:name});
      else{const a=h('a',{href:url,download:name});document.body.append(a);a.click();a.remove()}
    }catch(e){if(e&&e.name!=='AbortError')toast('แชร์ไม่สำเร็จ ลอง "เปิดดู"')}
  };
  document.body.append(overlay);
}
// ---- AI draft (drafted on the server from the saved case details; nothing is sent)
async function askAI(){
  const id=S.open,c=conv(id);if(!c||S.aiBusy)return;
  S.aiBusy=true;toast('กำลังร่างคำตอบ…');
  try{
    const r=await api('/v1/ai/draft',{id,version:c.version});
    if(S.open!==id){return}
    const cur=conv(id);if(!cur||cur.version!==c.version){toast('ข้อมูลแชทเปลี่ยนระหว่างร่าง ลองอีกครั้ง');return}
    const note=r.needsAdmin?'ต้องให้แอดมินตรวจ: '+(r.reason||'')+(r.missing&&r.missing.length?'\nขาด: '+r.missing.join(', '):''):'';
    const use=h('button',{type:'button',class:'go'},'ใส่ในช่องพิมพ์'),no=h('button',{type:'button'},'ยกเลิก');
    const overlay=h('div',{class:'overlay'},h('div',{class:'sheet tall'},h('h2',null,'ร่างจาก AI'),note?h('div',{class:'note'},note):null,h('div',{class:'text'},r.draft||''),
      h('div',{class:'meta'},'ตรวจก่อนส่งทุกครั้ง · '+(r.model||'')),h('div',{class:'actions'},no,use)));
    no.onclick=()=>overlay.remove();
    use.onclick=()=>{const ta=S.chat&&S.chat.els&&S.chat.els.ta;if(ta){ta.value=r.draft||'';ta.dispatchEvent(new Event('input'));ta.focus()}overlay.remove();toast('ใส่ร่างแล้ว กรุณาตรวจก่อนส่ง')};
    document.body.append(overlay);
  }catch(e){toast(e.message||'สร้างร่างไม่สำเร็จ')}
  finally{S.aiBusy=false}
}
// ---- สินค้าและราคา (read only; the prices live in the shop database)
async function openCatalog(){
  S.ph='catalog';
  const body=h('div',{class:'ordersbody full'},h('div',{class:'empty'},'กำลังโหลด…'));
  root.replaceChildren(h('div',{class:'bar'},logoImg(),h('h1',null,'สินค้าและราคา')),menuTabs('catalog'),body);
  try{
    const c=await rpc('inbox_catalog',{});
    if(S.ph!=='catalog')return;
    const ruleText=r=>r.type==='unit_price_tier'&&r.unit_price!=null?r.min_qty+' ชิ้นขึ้นไป '+money2(r.unit_price)+' บาท/ชิ้น':(r.percent!=null?r.min_qty+' ชิ้นขึ้นไป ลด '+money2(r.percent)+'%':'');
    const nodes=(c.types||[]).map(t=>h('div',{class:'ocard'},
      h('div',{class:'otop'},h('b',null,t.name),t.design_included?h('span',{class:'chip'},'รวมออกแบบ'):null),
      t.spec?h('div',{class:'meta'},t.spec):null,
      h('div',{class:'items'},(t.sizes||[]).map(z=>h('div',{class:'item'},h('span',null,z.label),h('span',null,money2(z.price)+' บาท')))),
      (t.rules&&t.rules.length)?h('div',{class:'meta'},t.rules.map(ruleText).filter(Boolean).join(' • ')+' (นับรวมทุกขนาดของสินค้านี้)'):null));
    if(c.shipping&&c.shipping.length)nodes.push(h('div',{class:'ocard'},h('b',null,'ค่าจัดส่ง'),c.shipping.map(x=>h('div',{class:'kv'},h('span',null,x.label),h('b',null,x.fee==null?'ตามจริง':money2(x.fee)+' บาท')))));
    body.replaceChildren(...(nodes.length?nodes:[h('div',{class:'empty'},'ยังไม่มีสินค้า')]));
  }catch(e){body.replaceChildren(h('div',{class:'empty'},e.message))}
}
// ---- คลังผลงาน: browse, or pick a picture to send into the open chat (pick=true)
function pubUrl(path){
  if(typeof path!=='string'||!path)return null;
  if(/^https:\/\//.test(path))return path;
  if(path.startsWith('/')||path.includes('..'))return null;
  return SB+'/storage/v1/object/public/portfolio/'+path.split('/').map(encodeURIComponent).join('/');
}
const assetPics=new Map();
function isLocalPath(p){return typeof p==='string'&&p.startsWith('/')&&!p.includes('..')&&/\.(jpg|png)$/i.test(p)}
function assetBlob(path){
  const name='sheet-'+path.split('/').pop();
  if(!assetPics.has(name))assetPics.set(name,authed(async()=>{const r=await fetch(API+'/v1/asset?name='+encodeURIComponent(name),{headers:{Authorization:'Bearer '+S.session.token},cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
    if(!r.ok)throw new ApiError(r.status,'โหลดรูปไม่ได้');return r.blob()}).catch(e=>{assetPics.delete(name);throw e}));
  return assetPics.get(name);
}
async function openPortfolio(pick){
  const st={type:'all',size:null,kind:null,tags:new Set(),tagOpen:false,lib:null};
  const grid=h('div',{class:'pgrid'},h('div',{class:'empty'},'กำลังโหลด…'));
  const chips=h('div',{class:'filters'});
  // Pinch the grid like the Photos app: fewer, larger pictures when spreading, more and smaller when pinching in.
  let cols=3;try{cols=Math.min(6,Math.max(1,Number(localStorage.getItem('standbyy.pcols'))||3))}catch(e){}
  const applyCols=()=>{grid.style.gridTemplateColumns='repeat('+cols+',minmax(0,1fr))';grid.classList.toggle('nocap',cols>=5);grid.classList.toggle('bigcap',cols<=2);try{localStorage.setItem('standbyy.pcols',String(cols))}catch(e){}};
  applyCols();
  let d0=null;
  const dist=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
  grid.addEventListener('touchstart',e=>{d0=e.touches.length===2?dist(e.touches):null},{passive:true});
  grid.addEventListener('touchmove',e=>{
    if(e.touches.length!==2||d0==null)return;e.preventDefault();
    const sc=dist(e.touches)/d0;
    if(sc>1.3&&cols>1){cols--;applyCols();d0=dist(e.touches)}
    else if(sc<0.75&&cols<6){cols++;applyCols();d0=dist(e.touches)}
  },{passive:false});
  grid.addEventListener('touchend',()=>{d0=null});
  grid.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();if(e.deltaY<0&&cols>1)cols--;else if(e.deltaY>0&&cols<6)cols++;applyCols()},{passive:false});
  let overlay=null;
  if(pick){
    overlay=h('div',{class:'overlay viewer filelayer'},h('div',{class:'pickhead'},h('b',null,'เลือกรูปส่งเข้าแชท'),h('button',{type:'button',onclick:()=>overlay.remove()},'✕')),chips,grid);
    document.body.append(overlay);
  }else{
    S.ph='portfolio';
    root.replaceChildren(h('div',{class:'bar'},logoImg(),h('h1',null,'คลังผลงาน')),menuTabs('portfolio'),chips,grid);
  }
  const KINDS=[['portfolio','ผลงานจริง'],['price_sheet','ตารางราคา'],['size_guide','เทียบขนาด']];
  const draw=()=>{
    const lib=st.lib;if(!lib)return;
    const usable=i=>pubUrl(i.thumb_url||i.file_url)||isLocalPath(i.file_url);
    const byType=lib.images.filter(i=>usable(i)&&(st.type==='all'||i.product_type_id===st.type));
    const chip=(text,on,fn,n,dim)=>h('button',{type:'button',class:'fchip'+(on?' on':'')+(dim?' dim':''),onclick:fn},text+(n!=null?' '+n:''));
    const row=(label,nodes)=>h('div',{class:'frow'},h('span',{class:'flabel'},label),h('div',{class:'tabs scroll inline'},nodes));
    const type=lib.types.find(t=>t.id===st.type);
    const tagCount=new Map();lib.images.forEach(i=>(i.tags||[]).forEach(t=>{if(t)tagCount.set(t,(tagCount.get(t)||0)+1)}));
    const allTags=[...tagCount.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(x=>x[0]);
    const rows=[
      h('div',{class:'tabs scroll'},[chip('ทั้งหมด',st.type==='all',()=>{st.type='all';st.size=null;draw()}),...lib.types.map(t=>chip(t.name,st.type===t.id,()=>{st.type=t.id;st.size=null;draw()})),
        chip('🏷 แท็ก'+(st.tags.size?' ('+st.tags.size+')':''),st.tagOpen||st.tags.size>0,()=>{st.tagOpen=!st.tagOpen;draw()})]),
      row('ประเภทรูป',[chip('ทุกประเภท',!st.kind,()=>{st.kind=null;draw()}),...KINDS.map(([k,t])=>{const n=byType.filter(i=>i.kind===k).length;return chip(t,st.kind===k,()=>{st.kind=st.kind===k?null:k;draw()},n,!n)})])];
    if(type&&type.sizes&&type.sizes.length)rows.push(row('ขนาด',[chip('ทุกขนาด',!st.size,()=>{st.size=null;draw()}),...type.sizes.map(z=>{const n=byType.filter(i=>i.product_size_id===z.id).length;return chip(z.label,st.size===z.id,()=>{st.size=st.size===z.id?null:z.id;draw()},n,!n)})]));
    if(st.tagOpen)rows.push(h('div',{class:'frow tagrow'},allTags.length?allTags.map(t=>chip(t,st.tags.has(t),()=>{st.tags.has(t)?st.tags.delete(t):st.tags.add(t);draw()})).concat(st.tags.size?[chip('ล้างแท็ก',false,()=>{st.tags.clear();draw()})]:[]):[h('span',{class:'flabel'},'ยังไม่มีแท็ก')]));
    chips.replaceChildren(...rows);
    const items=byType.filter(i=>(!st.size||i.product_size_id===st.size)&&(!st.kind||i.kind===st.kind)&&(!st.tags.size||(i.tags||[]).some(t=>st.tags.has(t))));
    grid.replaceChildren(...(items.length?[h('div',{class:'pghint'},'ใช้สองนิ้วถ่าง/บีบเพื่อขยาย-ย่อรูป · '+items.length+' รูป'),...items.map(i=>{
      const local=isLocalPath(i.file_url);
      const img=h('img',{alt:i.caption||i.type_name||'ผลงาน',loading:'lazy',referrerPolicy:'no-referrer'});
      let fullUrl=null;
      if(local)assetBlob(i.file_url).then(b=>{fullUrl=URL.createObjectURL(b);img.src=fullUrl}).catch(()=>{});
      else img.src=pubUrl(i.thumb_url||i.file_url);
      return h('div',{class:'pcell',role:'button',tabindex:'0',onclick:()=>pick?sendPortfolio(i,overlay):viewPic(local?fullUrl:(pubUrl(i.file_url)||img.src))},h('div',{class:'pbox'},img),h('span',null,i.caption||[i.type_name,i.size_label].filter(Boolean).join(' ')));
    })]:[h('div',{class:'empty'},'ไม่มีรูปที่ตรงกับตัวกรอง')]));
  };
  try{st.lib=await rpc('inbox_portfolio',{});if(!pick&&S.ph!=='portfolio')return;draw()}
  catch(e){grid.replaceChildren(h('div',{class:'empty'},e.message))}
}
async function sendPortfolio(item,overlay){
  try{
    let blob;
    if(isLocalPath(item.file_url))blob=await assetBlob(item.file_url);
    else{const r=await fetch(pubUrl(item.file_url),{credentials:'omit',referrerPolicy:'no-referrer'});
      if(!r.ok)throw new Error('โหลดรูปไม่ได้');blob=await r.blob()}
    overlay.remove();
    await askSendImage(blob,false,()=>{rpc('inbox_portfolio_used',{p_ids:[item.id]}).catch(()=>{})});
  }catch(e){toast(e.message||'ส่งรูปไม่ได้')}
}

// ---- payment (slip required) and shipping for an order
async function uploadSlip(orderId,blob){
  const path=orderId.toLowerCase()+'/slip-'+uuid()+'.jpg';
  await authed(async()=>{
    const r=await fetch(SB+'/storage/v1/object/attachments/'+path,{method:'POST',headers:{apikey:S.session.publicKey,Authorization:'Bearer '+S.session.token,'Content-Type':'image/jpeg','x-upsert':'false'},body:blob,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!r.ok)throw new ApiError(r.status,'อัปโหลดสลิปไม่สำเร็จ กรุณาลองใหม่');
  });
  return path;
}
function paymentBlock(d,redraw){
  const box=h('div',{class:'ocard'},h('b',null,'การชำระเงิน'),h('div',{class:'empty small'},'กำลังโหลด…'));
  (async()=>{
    try{
      const info=await rpc('inbox_order_payment',{p_order:d.id});
      const rows=[h('b',null,'การชำระเงิน'),h('div',{class:'kv'},h('span',null,'สถานะ'),h('b',null,PAY[info.payment_status]||'ยังไม่ชำระ')),
        h('div',{class:'kv'},h('span',null,'ยอดรวม'),h('b',null,baht(info.total)))];
      if(info.deposit_amount)rows.push(h('div',{class:'kv'},h('span',null,'รับมัดจำแล้ว'),h('b',null,baht(info.deposit_amount))));
      if(info.slips)rows.push(h('div',{class:'meta'},'สลิป '+info.slips+' ใบ'));
      const allowed=info.status!=='cancelled'&&(info.status!=='done'||info.is_owner);
      if(allowed&&info.payment_status!=='paid'){
        if(info.payment_status==='unpaid')rows.push(h('button',{type:'button',class:'sumbtn',onclick:()=>paymentSheet(info,'deposit',redraw)},'รับมัดจำ…'));
        rows.push(h('button',{type:'button',class:'sumbtn',onclick:()=>paymentSheet(info,'paid',redraw)},'บันทึกชำระครบ…'));
      }
      box.replaceChildren(...rows);
    }catch(e){box.replaceChildren(h('b',null,'การชำระเงิน'),h('div',{class:'note err'},e.message))}
  })();
  return box;
}
function paymentSheet(info,mode,redraw){
  const already=info.deposit_amount||0;
  const amount=h('input',{type:'number',inputmode:'decimal',placeholder:'บาท',min:'1'});
  const file=h('input',{type:'file',accept:'image/*',style:'display:none'});
  const preview=h('img',{class:'pic',alt:'สลิป',style:'display:none;align-self:center;max-height:240px'});
  const pick=h('button',{type:'button',class:'sumbtn'},'เลือกรูปสลิป (บังคับ)');
  let slip=null;
  pick.onclick=()=>file.click();
  file.onchange=async()=>{const f=file.files[0];file.value='';if(!f)return;
    try{slip=await shrink(f);preview.src=URL.createObjectURL(slip);preview.style.display='';pick.textContent='เปลี่ยนรูปสลิป';err.style.display='none'}
    catch(e){err.textContent=e.message;err.style.display=''}};
  const err=h('div',{class:'note err',style:'display:none'});
  const go=h('button',{type:'button',class:'go'},'บันทึก'),cancel=h('button',{type:'button'},'ยกเลิก');
  const quick=mode==='deposit'?h('div',{class:'tabs'},[0.3,0.5,1].map(r=>h('button',{type:'button',onclick:()=>{amount.value=Math.round(info.total*r)}},r===1?'เต็มจำนวน':Math.round(r*100)+'%'))):null;
  const overlay=h('div',{class:'overlay'},h('div',{class:'sheet tall'},h('h2',null,(mode==='deposit'?'รับมัดจำ ':'บันทึกชำระครบ ')+info.order_no),
    h('div',{class:'kv'},h('span',null,'ยอดรวมทั้งบิล'),h('b',null,baht(info.total))),
    already?h('div',{class:'kv'},h('span',null,'รับมาแล้ว'),h('b',null,baht(already))):null,
    mode==='paid'?h('div',{class:'kv'},h('span',null,'ยอดคงเหลือ'),h('b',null,baht(Math.max(0,info.total-already)))):null,
    mode==='deposit'?h('label',{class:'fld'},h('span',null,'ยอดมัดจำ (บาท)'),amount):null,quick,
    pick,file,preview,err,h('div',{class:'actions'},cancel,go)));
  cancel.onclick=()=>overlay.remove();
  go.onclick=async()=>{
    err.style.display='none';
    let dep=null;
    if(mode==='deposit'){dep=Number(amount.value);if(!(dep>0&&dep<=info.total)){err.textContent='ยอดมัดจำต้องมากกว่า 0 และไม่เกินยอดรวม';err.style.display='';return}}
    if(!slip){err.textContent='กรุณาเลือกรูปสลิปโอนเงิน';err.style.display='';return}
    if(!confirm((mode==='deposit'?'บันทึกรับมัดจำ '+baht(dep):'บันทึกชำระครบ')+' ของ '+info.order_no+'?'))return;
    go.disabled=cancel.disabled=true;
    try{
      const path=await uploadSlip(info.order_id,slip);
      await rpc('inbox_set_order_payment',{p_order:info.order_id,p_status:mode,p_expected:info.payment_status,p_deposit_amount:dep,p_slip_path:path});
      overlay.remove();toast('บันทึกการชำระเงินแล้ว');redraw();
    }catch(e){err.textContent=e.message;err.style.display='';go.disabled=cancel.disabled=false}
  };
  document.body.append(overlay);
}
function shippingBlock(d,redraw){
  const box=h('div',{class:'ocard'},h('b',null,'จัดส่งและหมายเหตุ'),h('div',{class:'empty small'},'กำลังโหลด…'));
  (async()=>{
    try{
      const info=await rpc('inbox_order_shipping',{p_order:d.id});
      if(info.status==='cancelled'){box.replaceChildren(h('b',null,'จัดส่งและหมายเหตุ'),h('div',{class:'meta'},'ออเดอร์ที่ยกเลิกแล้วแก้ไขไม่ได้'));return}
      const shipped=['shipped','done'].includes(info.status);
      const method=h('select',{disabled:shipped},info.options.map(o=>h('option',{value:o.method,selected:o.method===info.shipping_method},o.label+(o.fee==null?' • ตามจริง':' • '+money2(o.fee)+' บาท'))));
      const fee=h('input',{type:'number',inputmode:'decimal',disabled:shipped});fee.value=info.shipping_fee;
      const feeRow=h('label',{class:'fld'},h('span',null,'ค่าส่ง (บาท)'),fee);
      const addr=h('textarea',{rows:3,placeholder:info.customer_address?'ที่อยู่ลูกค้า: '+info.customer_address:'ที่อยู่ผู้รับ'});addr.value=info.shipping_address||'';
      const save=h('input',{type:'checkbox'});
      const track=h('input',{type:'text'});track.value=info.tracking_no||'';
      const note=h('textarea',{rows:2,disabled:shipped});note.value=info.internal_note||'';
      const msg=h('div',{class:'note err',style:'display:none'});
      const opt=()=>info.options.find(o=>o.method===method.value);
      const sync=()=>{const o=opt();feeRow.style.display=(o&&o.fee==null&&method.value!=='pending')?'':'none'};
      method.onchange=sync;sync();
      const btn=h('button',{type:'button',class:'sumbtn'},'บันทึก');
      btn.onclick=async()=>{
        const o=opt(),changed=method.value!==info.shipping_method;
        const feeVal=o&&o.fee==null&&(changed||Number(fee.value)!==info.shipping_fee)?Number(fee.value||0):null;
        const addrChanged=addr.value!==(info.shipping_address||'')||save.checked;
        btn.disabled=true;msg.style.display='none';
        try{
          const r=await rpc('inbox_update_order_shipping',{p_order:d.id,p_expected_method:info.shipping_method,p_method:changed?method.value:null,p_fee:feeVal,
            p_address:addrChanged?addr.value:null,p_save_address:save.checked,p_tracking:track.value!==(info.tracking_no||'')?track.value:null,p_note:note.value!==(info.internal_note||'')?note.value:null});
          toast(r.changes&&r.changes.length?'บันทึก '+r.changes.join(', ')+' แล้ว':'ไม่มีการเปลี่ยนแปลง');redraw();
        }catch(e){msg.textContent=e.message;msg.style.display='';btn.disabled=false}
      };
      box.replaceChildren(...[h('b',null,'จัดส่งและหมายเหตุ'),
        info.shipping_method==='pending'?h('div',{class:'note'},'ยังไม่เลือกวิธีส่ง'):null,
        h('label',{class:'fld'},h('span',null,'วิธีจัดส่ง'),method),feeRow,
        h('label',{class:'fld'},h('span',null,'ที่อยู่จัดส่ง'),addr),
        h('label',{class:'chk'},save,' บันทึกเป็นที่อยู่ตั้งต้นของลูกค้าด้วย'),
        h('label',{class:'fld'},h('span',null,'เลขพัสดุ'),track),
        h('label',{class:'fld'},h('span',null,'หมายเหตุภายใน'),note),msg,btn].filter(Boolean));
    }catch(e){box.replaceChildren(h('b',null,'จัดส่งและหมายเหตุ'),h('div',{class:'note err'},e.message))}
  })();
  return box;
}

// Needs my shift and this chat: a popup offers "เข้าเวรและรับแชท" and continues once done (resolves false when cancelled or not allowed).
function ensureShiftAndChat(chat,why){
  return new Promise(async resolve=>{
    let cur=conv(chat);if(!cur){resolve(false);return}
    if(onDuty()&&cur.owner===S.session.id){resolve(true);return}
    if(cur.owner&&cur.owner!==S.session.id){toast('แชทนี้เป็นของ '+adminName(cur.owner)+' ต้องให้เจ้าของปล่อยหรือส่งต่อก่อน');resolve(false);return}
    const go=h('button',{type:'button',class:'go'},onDuty()?'รับแชทนี้':'เข้าเวรและรับแชท'),no=h('button',{type:'button'},'ยกเลิก');
    const note=h('div',{class:'note err',style:'display:none'});
    const overlay=h('div',{class:'overlay',style:'z-index:60'},h('div',{class:'sheet'},h('h2',null,'ต้องเข้าเวรและรับแชทก่อน'),
      h('div',{class:'kv'},h('span',null,'เวรของคุณ'),h('b',null,onDuty()?'เข้าเวรอยู่':'ยังไม่ได้เข้าเวร')),
      h('div',{class:'kv'},h('span',null,'ผู้ดูแลแชทนี้'),h('b',null,cur.owner?adminName(cur.owner):'ยังไม่มี')),
      h('div',{class:'meta'},why||'ระบบกำหนดให้เข้าเวรและเป็นผู้ดูแลแชทนี้ก่อนจึงทำรายการนี้ได้'),note,h('div',{class:'actions'},no,go)));
    no.onclick=()=>{overlay.remove();resolve(false)};
    go.onclick=async()=>{
      go.disabled=no.disabled=true;note.style.display='none';
      try{
        cur=conv(chat);
        if(!onDuty())await api('/v1/shift',{onDuty:true});
        await poll(true);cur=conv(chat);
        if(cur&&!cur.owner)await api('/v1/claim',{id:chat});
        await poll(true);overlay.remove();resolve(true);
      }catch(e){note.textContent=e.message;note.style.display='';go.disabled=no.disabled=false}
    };
    document.body.append(overlay);
  });
}

// ---- create an order draft from the chat (same rules as the Mac app; the server prices catalog lines)
function todayInput(){return new Date().toLocaleDateString('en-CA',{timeZone:tz})}
async function openDraftOrder(){
  const chat=S.open,c=conv(chat);if(!c)return;
  const lines=[];const requestID=uuid();
  const layer=h('div',{class:'overlay viewer filelayer'});
  const head=h('div',{class:'pickhead'},h('b',null,'สร้างออเดอร์ร่าง · '+(c.customer||'')),h('button',{type:'button',onclick:()=>{layer.remove();toast('เก็บข้อมูลที่กรอกไว้ให้แล้ว')}},'✕'));
  const body=h('div',{class:'ordersbody full'},h('div',{class:'empty'},'กำลังโหลดตารางสินค้า…'));
  layer.append(head,body);document.body.append(layer);
  let catalog,reasons=[];
  try{catalog=await rpc('inbox_draft_catalog',{});reasons=((await rpc('inbox_quick_texts',{}).catch(()=>({}))).discount_reasons)||[]}
  catch(e){body.replaceChildren(h('div',{class:'empty'},e.message));return}
  const types=[...new Set(catalog.map(z=>z.product))];
  const typeSel=h('select',null,[h('option',{value:''},'เลือกประเภทสินค้า'),...types.map(t=>h('option',{value:t},t))]);
  const sizeSel=h('select',{disabled:true},[h('option',{value:''},'เลือกขนาด')]);
  typeSel.onchange=()=>{
    const list=catalog.filter(z=>z.product===typeSel.value);
    sizeSel.replaceChildren(h('option',{value:''},list.length?'เลือกขนาด':'เลือกประเภทสินค้าก่อน'),...list.map(z=>h('option',{value:z.id},z.size+' · '+money2(z.price)+' บาท')));
    sizeSel.disabled=!list.length;
  };
  const qty=h('input',{type:'number',inputmode:'numeric',min:'1',max:'999',value:'1'});
  const custom=h('input',{type:'checkbox'});
  const cSize=h('input',{type:'text',placeholder:'ขนาดพิเศษ (เช่น 80×200 ซม.)'}),cPrice=h('input',{type:'number',inputmode:'decimal',placeholder:'ราคาต่อชิ้น (บาท)'});
  const customBox=h('div',{style:'display:none;gap:8px;flex-direction:column'},cSize,cPrice);
  custom.onchange=()=>{customBox.style.display=custom.checked?'flex':'none';sizeSel.style.display=custom.checked?'none':''};
  const list=h('div',{class:'items'});
  const totalEl=h('div',{class:'kv'});
  const needed=h('input',{type:'date',min:todayInput()});
  const ship=h('select',null,[['pending','รอคอนเฟิร์ม'],['ems','EMS'],['grab_normal','Grab (ร้านเรียก)'],['grab_from_customer','Grab (ลูกค้าเรียก)'],['pickup','รับที่ร้าน']].map(([v,t])=>h('option',{value:v},t)));
  const note=h('textarea',{rows:3,placeholder:'เช่น รายละเอียดแบบ หรือสิ่งที่ต้องระวัง'});
  const dType=h('select',null,[['none','ไม่มีส่วนลด'],['percent','ส่วนลด %'],['amount','ส่วนลดเป็นเงิน']].map(([v,t])=>h('option',{value:v},t)));
  const dVal=h('input',{type:'number',inputmode:'decimal',placeholder:'ค่าส่วนลด'});
  const dReason=h('input',{type:'text',placeholder:'เหตุผลส่วนลด',list:'dreasons'});
  const dl=h('datalist',{id:'dreasons'},reasons.map(r=>h('option',{value:r})));
  const err=h('div',{class:'note err',style:'display:none'});
  const itemsTotal=()=>lines.reduce((n,l)=>n+l.price*l.quantity,0);
  const redraw=()=>{
    list.replaceChildren(...(lines.length?lines.map((l,i)=>h('div',{class:'item'},h('span',null,l.label+(l.custom?' (ขนาดพิเศษ)':'')+' × '+l.quantity),h('span',null,baht(l.price*l.quantity)+' ',h('button',{type:'button',class:'replybtn',onclick:()=>{lines.splice(i,1);redraw()}},'✕')))):[h('div',{class:'meta'},'ยังไม่มีรายการ')]));
    totalEl.replaceChildren(h('span',null,'รวมก่อนส่วนลด'),h('b',null,baht(itemsTotal())));
    if(typeof persist==='function')persist();
  };
  const add=h('button',{type:'button',class:'sumbtn'},'เพิ่มรายการ');
  add.onclick=()=>{
    err.style.display='none';const q=Number(qty.value);
    if(!Number.isInteger(q)||q<1||q>999){err.textContent='จำนวนต้องเป็นเลข 1-999';err.style.display='';return}
    if(lines.length>=50){err.textContent='ใส่ได้ไม่เกิน 50 รายการ';err.style.display='';return}
    if(custom.checked){const price=Number(cPrice.value);
      if(!typeSel.value||!cSize.value.trim()||!(price>=0)||cPrice.value===''){err.textContent='เลือกประเภทสินค้า และกรอกขนาดกับราคาให้ครบ';err.style.display='';return}
      lines.push({custom:true,label:typeSel.value+' · '+cSize.value.trim(),price,quantity:q,payload:{product_name:typeSel.value,size_label:cSize.value.trim(),quantity:q,unit_price:price}});
      cSize.value=cPrice.value='';
    }else{const z=catalog.find(x=>x.id===sizeSel.value);if(!z){err.textContent=typeSel.value?'เลือกขนาดก่อน':'เลือกประเภทสินค้าและขนาดก่อน';err.style.display='';return}
      lines.push({label:z.product+' · '+z.size,price:z.price,quantity:q,payload:{size_id:z.id,quantity:q}});sizeSel.value=''}
    qty.value='1';redraw();
  };
  const save=h('button',{type:'button',class:'sumbtn'},'บันทึกร่าง');
  save.onclick=async()=>{
    err.style.display='none';
    const fail=t=>{err.textContent=t;err.style.display='';save.disabled=false};
    if(!lines.length)return fail('เพิ่มรายการสินค้าก่อน');
    if(!needed.value)return fail('เลือกวันที่ลูกค้าต้องการใช้งาน');
    const dv=Number(dVal.value||0),dt=dType.value;
    if(dt!=='none'&&dv>0){if(dt==='percent'&&dv>100)return fail('ส่วนลดไม่เกิน 100%');if(!dReason.value.trim())return fail('ใส่เหตุผลส่วนลด')}
    if(!confirm('บันทึกออเดอร์ร่างของ '+(c.customer||'ลูกค้า')+' ('+lines.length+' รายการ)?'))return;
    save.disabled=true;
    try{
      if(!await ensureShiftAndChat(chat,'ต้องเข้าเวรและเป็นผู้ดูแลแชทนี้ก่อนจึงบันทึกออเดอร์ได้ ข้อมูลที่กรอกยังอยู่ครบ')){save.disabled=false;return}
      const draft=await rpc('inbox_create_order_draft',{p_id:requestID,p_conversation:chat,p_needed:needed.value,p_shipping:ship.value,p_items:lines.map(l=>l.payload),p_note:note.value.trim()});
      let extra='';
      if(dt!=='none'&&dv>0){
        try{const fresh=await rpc('inbox_order_detail',{p_order:draft.id});
          const r=await rpc('inbox_set_order_discount',{p_order:draft.id,p_type:dt,p_value:dv,p_reason:dReason.value.trim(),p_expected_total:fresh.total});
          if(r&&r.discount_needs_approval)extra=' (ส่วนลดรอเจ้าของร้านอนุมัติ)'}
        catch(e){extra=' แต่ใส่ส่วนลดไม่สำเร็จ: '+e.message}
      }
      try{localStorage.removeItem(key)}catch(e){}
      layer.remove();toast('บันทึกออเดอร์ '+draft.order_no+' แล้ว'+extra);openChatOrders();
    }catch(e){fail(e.message)}
  };
  const fld=(t,el)=>h('label',{class:'fld'},h('span',null,t),el);
  // The form is kept on this phone until the order is saved, so closing the page never loses it.
  const key='standbyy.draft.'+chat;
  const persist=()=>{try{localStorage.setItem(key,JSON.stringify({lines,needed:needed.value,ship:ship.value,note:note.value,dType:dType.value,dVal:dVal.value,dReason:dReason.value}))}catch(e){}};
  try{const sv=JSON.parse(localStorage.getItem(key)||'null');
    if(sv){(sv.lines||[]).forEach(l=>lines.push(l));needed.value=sv.needed||'';ship.value=sv.ship||'pending';note.value=sv.note||'';dType.value=sv.dType||'none';dVal.value=sv.dVal||'';dReason.value=sv.dReason||''}}catch(e){}
  layer.addEventListener('input',persist);layer.addEventListener('change',persist);
  body.replaceChildren(
    h('div',{class:'ocard'},h('b',null,'รายการสินค้า'),list,totalEl),
    h('div',{class:'ocard'},h('b',null,'เพิ่มสินค้า'),fld('ประเภท',typeSel),fld('ขนาด',sizeSel),customBox,h('label',{class:'chk'},custom,' ขนาดพิเศษ (กำหนดราคาเอง)'),fld('จำนวน',qty),add),
    h('div',{class:'ocard'},h('b',null,'ส่วนลด'),dType,dVal,dReason,dl),
    h('div',{class:'ocard'},h('b',null,'วันใช้งานและการจัดส่ง'),fld('วันที่ลูกค้าต้องการใช้งาน',needed),fld('รับสินค้า',ship)),
    h('div',{class:'ocard'},h('b',null,'โน้ตออเดอร์'),note),
    h('div',{class:'meta'},'ปิดหน้านี้ได้ ข้อมูลที่กรอกจะถูกเก็บไว้จนกว่าจะบันทึกออเดอร์'),
    h('div',{class:'meta'},'ราคาเป็นราคาก่อนส่วนลดตามจำนวน ระบบคำนวณส่วนลดตามจำนวนเมื่อบันทึก วันผลิตเริ่มนับหลังยืนยันสั่งงาน'),
    err,save);
  redraw();
}
// ---- confirm an order from its chat (the server checks shift, ownership, chat version and lead time)
async function confirmOrderSheet(d,redraw){
  const chat=S.open,c=conv(chat);if(!c)return;
  const body=h('div',{class:'ordersbody'},h('div',{class:'empty'},'กำลังตรวจแผนงาน…'));
  const close=h('button',{type:'button'},'ปิด'),go=h('button',{type:'button',class:'go',disabled:true},'ยืนยันสั่งงาน');
  const overlay=h('div',{class:'overlay'},h('div',{class:'sheet tall'},h('h2',null,'ยืนยันสั่งงาน '+d.order_no),body,h('div',{class:'actions'},close,go)));
  close.onclick=()=>overlay.remove();document.body.append(overlay);
  try{
    const plan=await rpc('inbox_confirm_order_preview',{p_conversation:chat,p_order:d.id});
    const rg=(a,b)=>a===b?dateTh(a):dateTh(a)+' – '+dateTh(b);
    const kv=(k,v)=>h('div',{class:'kv'},h('span',null,k),h('b',null,v));
    const msgs=((S.chat&&S.chat.messages)||[]).filter(m=>m.direction==='inbound'&&m.body&&m.body!=='ข้อความถูกยกเลิก').slice(-15).reverse();
    const ev=h('select',null,[h('option',{value:''},'ไม่อ้างอิงข้อความ'),...msgs.map(m=>h('option',{value:m.id},hm(ts(m.created)||0)+' • '+String(m.body).slice(0,50)))]);
    const risky=plan.lead_time_status!=='ok';
    const ack=h('input',{type:'checkbox'});
    const nodes=[kv('รายการสินค้า',plan.item_count+' รายการ'),kv('ยอดรวม',baht(plan.total)),kv('ผลิตเสร็จประมาณ',rg(plan.production_from,plan.production_to)),
      kv('ส่งออก',rg(plan.ship_from,plan.ship_to)),kv('ถึงลูกค้าประมาณ',rg(plan.arrival_from,plan.arrival_to)),kv('วันที่ต้องการใช้งาน',dateTh(plan.needed_by)),
      plan.shipping_pending?h('div',{class:'note'},'ยังไม่เลือกวิธีส่ง ระบบประเมินเวลาขนส่งแบบเผื่อไว้'):null,
      risky?h('div',{class:'note err'},'อาจไม่ทันวันใช้งาน ('+plan.lead_time_status+')'):null,
      risky?h('label',{class:'chk'},ack,' ประเมินงานเร่งแล้ว ยืนยันรับงานแม้อาจไม่ทันวันใช้งาน'):null,
      h('label',{class:'fld'},h('span',null,'ข้อความที่ลูกค้ายืนยัน'),ev)];
    if(!plan.can_confirm)nodes.push(h('div',{class:'note err'},plan.item_count===0?'เพิ่มรายการสินค้าในออเดอร์ก่อนยืนยัน':'ออเดอร์นี้ไม่ได้อยู่ในสถานะรอคอนเฟิร์ม'));
    const msg=h('div',{class:'note err',style:'display:none'});nodes.push(msg);
    body.replaceChildren(...nodes.filter(Boolean));go.disabled=!plan.can_confirm;
    go.onclick=async()=>{
      msg.style.display='none';
      if(risky&&!ack.checked){msg.textContent='ติ๊กยืนยันรับงานเร่งก่อน';msg.style.display='';return}
      go.disabled=close.disabled=true;
      try{
        if(!await ensureShiftAndChat(chat,'ต้องเข้าเวรและเป็นผู้ดูแลแชทนี้ก่อนจึงยืนยันสั่งงานได้')){go.disabled=close.disabled=false;return}
        const cur=conv(chat);
        const r=await rpc('inbox_confirm_order',{p_conversation:chat,p_order:d.id,p_chat_version:cur.version,p_evidence_message:ev.value||null,p_acknowledge_risk:!!ack.checked});
        overlay.remove();toast(r.already?'ออเดอร์นี้ยืนยันไว้แล้ว':'ยืนยันสั่งงานแล้ว · ผลิตเสร็จประมาณ '+rg(r.production_from,r.production_to));
        await poll(true);redraw();
      }catch(e){msg.textContent=e.message;msg.style.display='';go.disabled=false;close.disabled=false}
    };
  }catch(e){body.replaceChildren(h('div',{class:'note err'},e.message))}
}

// ---- orders workspace (list, search, detail, status moves)
const ORDER_FILTERS=[['open','เปิดอยู่'],['all','ทั้งหมด'],['inquiry','รอคอนเฟิร์ม'],['confirmed','คอนเฟิร์มแล้ว'],['designing','ออกแบบ'],['design_approved','อนุมัติแบบ'],['in_production','ผลิต'],['ready_to_ship','พร้อมส่ง'],['shipped','ส่งแล้ว'],['done','เสร็จ'],['cancelled','ยกเลิก']];
const CHANNEL={line:'LINE',tiktok:'TikTok',ig:'IG'};
function openOrdersTab(){
  S.ord={q:'',status:'open',rows:[],total:0,page:1,loading:false,view:'list',timer:null};
  listEls=null;drawOrders();loadOrders(true);
}
function closeOrdersTab(){S.ord=null;renderList();poll(true)}
function drawOrders(){
  const o=S.ord;if(!o)return;
  const search=h('input',{type:'search',placeholder:'ค้นหาเลขออเดอร์ ชื่อ หรือเบอร์โทร',value:o.q,oninput:e=>{o.q=e.target.value;clearTimeout(o.timer);o.timer=setTimeout(()=>loadOrders(true),400)}});
  const chips=h('div',{class:'tabs scroll'},ORDER_FILTERS.map(([k,t])=>h('button',{type:'button',class:o.status===k?'on':'','data-k':k,onclick:()=>{o.status=k;for(const b of chips.children)b.classList.toggle('on',b.dataset.k===k);loadOrders(true)}},t)));
  o.listEl=h('div',{class:'list'});pullRefresh(o.listEl,()=>loadOrders(true));
  root.replaceChildren(h('div',{class:'bar'},logoImg(),h('h1',null,'รายการออเดอร์',h('small',{id:'ordcount'},''))),menuTabs('orders'),
    chips,h('div',{class:'search'},search),o.listEl);
  fillOrders();
}
async function loadOrders(reset){
  const o=S.ord;if(!o||o.loading&&!reset)return;
  if(reset){o.page=1;o.rows=[]}
  o.loading=true;fillOrders();
  const mine=o;
  try{
    const r=await rpc('inbox_order_list',{p_query:o.q.trim(),p_status:o.status,p_channel:'all',p_page:o.page,p_sort:'needed',p_desc:true});
    if(S.ord!==mine)return;
    if(reset)o.rows=[];
    o.rows.push(...r.rows);o.total=r.total;o.error='';
  }catch(e){if(S.ord===mine)o.error=e.message}
  if(S.ord===mine){o.loading=false;fillOrders()}
}
function fillOrders(){
  const o=S.ord;if(!o||!o.listEl||o.view!=='list')return;
  const cnt=document.getElementById('ordcount');if(cnt)cnt.textContent=o.total?o.total+' รายการ':'';
  const nodes=o.rows.map(orderRow);
  if(o.error)nodes.unshift(h('div',{class:'note err'},o.error));
  if(o.loading)nodes.push(h('div',{class:'empty'},'กำลังโหลด…'));
  else if(!o.rows.length&&!o.error)nodes.push(h('div',{class:'empty'},'ไม่พบออเดอร์'));
  else if(o.rows.length<o.total)nodes.push(h('button',{type:'button',class:'older',style:'margin:12px auto;display:block',onclick:()=>{o.page++;loadOrders(false)}},'โหลดเพิ่ม'));
  o.listEl.replaceChildren(...nodes);
}

function orderRow(r){
  return h('button',{type:'button',class:'row',onclick:()=>openOrderDetail(r.id)},
    h('div',{class:'rowmain'},
      h('div',{class:'rowtop'},h('div',{class:'rowname'},r.order_no+' · '+(r.customer_name||'')),h('div',{class:'rowtime'},baht(r.total))),
      h('div',{class:'rowbottom'},h('span',{class:'chip'},STATUS[r.status]||r.status),h('span',{class:'chip'+(r.payment_status==='paid'?'':' wait')},PAY[r.payment_status]||'ยังไม่ชำระ'),
        h('span',{class:'rowpreview'},(CHANNEL[r.source_channel]||r.source_channel||'')+' · ส่งของ '+dateTh(r.needed_by_date)))));
}
// The chat's "ออเดอร์" button: the same order screens as รายการออเดอร์, for the orders linked to this chat.
async function openChatOrders(){
  const chat=S.open;if(!chat)return;
  S.ord={fromChat:chat,view:'chatlist',rows:[],total:0,q:'',status:'all'};
  const o=S.ord;
  const list=h('div',{class:'list'},h('div',{class:'empty'},'กำลังโหลด…'));
  const backToChat=()=>{S.ord=null;if(S.chat){buildChat();drawMessages(true)}else openChat(chat)};
  o.backToChat=backToChat;
  nav.push(backToChat,null);
  o.showList=()=>{o.view='chatlist';root.replaceChildren(h('div',{class:'bar'},h('button',{type:'button',class:'back','aria-label':'กลับ',onclick:()=>nav.back(backToChat)},'‹'),h('h1',null,'ออเดอร์ของแชทนี้',h('small',null,(conv(chat)||{}).customer||'')),h('button',{type:'button','aria-label':'สร้างออเดอร์',onclick:openDraftOrder},'＋ สร้างออเดอร์')),list)};
  o.showList();
  try{
    const rows=await rpc('inbox_linked_orders',{p_conversation:chat});
    if(S.ord!==o)return;
    o.chatRows=rows;
    if(rows.length===1){openOrderDetail(rows[0].id);return}
    list.replaceChildren(...(rows.length?rows.map(orderRow):[h('div',{class:'empty'},'ยังไม่มีออเดอร์ที่ผูกกับแชทนี้')]));
  }catch(e){list.replaceChildren(h('div',{class:'empty'},e.message))}
}
async function openOrderDetail(id){
  const o=S.ord;if(!o)return;o.view='detail';
  const toList=()=>{o.view='list';drawOrders();fillOrders();loadOrders(true)};
  if(!o.fromChat)nav.push(toList,null);else if(o.chatRows&&o.chatRows.length>1)nav.push(()=>o.showList(),null);
  const body=h('div',{class:'ordersbody full'},h('div',{class:'empty'},'กำลังโหลด…'));
  root.replaceChildren(h('div',{class:'bar'},h('button',{type:'button',class:'back','aria-label':'กลับ',onclick:()=>{if(o.fromChat){if(o.chatRows&&o.chatRows.length>1)nav.back(()=>o.showList());else nav.back(o.backToChat);return}nav.back(toList)}},'‹'),h('h1',null,'ออเดอร์'),o.fromChat?h('button',{type:'button','aria-label':'สร้างออเดอร์',onclick:openDraftOrder},'＋ สร้างออเดอร์'):null),body);
  async function draw(){
    try{
      const [d,opt]=await Promise.all([rpc('inbox_order_detail',{p_order:id}),rpc('inbox_order_status_options',{p_order:id})]);
      if(S.ord!==o||o.view!=='detail')return;
      const nodes=[orderCard(d)];
      const info=[];
      if(d.design_approved_planned)info.push(['อนุมัติแบบ (แผน)',dateTh(d.design_approved_planned)]);
      if(d.ship_by_planned)info.push(['วันส่งของ (แผน)',dateTh(d.ship_by_planned)]);
      if(d.priority&&d.priority!=='normal')info.push(['ความสำคัญ',d.priority]);
      if(info.length)nodes.push(h('div',{class:'ocard'},info.map(([k,v])=>h('div',{class:'kv'},h('span',null,k),h('b',null,v)))));
      if(o.fromChat&&d.status==='inquiry'&&S.chat)nodes.push(h('button',{type:'button',class:'sumbtn',onclick:()=>confirmOrderSheet(d,draw)},'✅ ยืนยันสั่งงาน…'));
      nodes.push(statusBlock(d,opt,draw));
      nodes.push(paymentBlock(d,draw));
      nodes.push(shippingBlock(d,draw));
      if(!o.fromChat&&d.conversation_id&&conv(d.conversation_id))nodes.push(h('button',{type:'button',class:'menuitem',onclick:()=>{S.ord=null;openChat(d.conversation_id)}},'💬 เปิดแชทลูกค้า'));
      body.replaceChildren(...nodes);
    }catch(e){body.replaceChildren(h('div',{class:'empty'},e.message))}
  }
  draw();
}
function statusBlock(d,opt,redraw){
  const box=h('div',{class:'ocard'},h('b',null,'สถานะงาน: '+(opt.status_label||STATUS[d.status])));
  const msg=h('div',{class:'note err',style:'display:none'});
  const move=async(to,label,reason)=>{
    if(!confirm((to==='cancelled'?'ยกเลิก ':'เปลี่ยน ')+d.order_no+(to==='cancelled'?'?':' เป็น '+label+'?')))return;
    try{await rpc('inbox_set_order_status',{p_order:d.id,p_expected:opt.status,p_to:to,p_reason:reason||null});toast('เปลี่ยนสถานะแล้ว');redraw()}
    catch(e){msg.textContent=e.message;msg.style.display='';redraw&&setTimeout(()=>{},0)}
  };
  if(opt.next){const b=h('button',{type:'button',class:'sumbtn',disabled:opt.next_blockers.length>0,onclick:()=>move(opt.next,opt.next_label)},'เปลี่ยนเป็น '+opt.next_label);box.append(b);
    if(opt.next_blockers.length)box.append(h('div',{class:'note'},'ยังขาด: '+opt.next_blockers.join(' · ')))}
  if(opt.can_restore){if(opt.cancel_reason)box.append(h('div',{class:'meta'},'เหตุผลที่ยกเลิก: '+opt.cancel_reason));box.append(h('button',{type:'button',class:'sumbtn',onclick:()=>move('confirmed','คอนเฟิร์มแล้ว')},'กลับมาใช้งาน (คอนเฟิร์มแล้ว)'))}
  if(opt.previous)box.append(h('button',{type:'button',class:'menuitem',disabled:opt.previous_blockers.length>0,onclick:()=>move(opt.previous,opt.previous_label)},'ย้อนเป็น '+opt.previous_label));
  if(opt.can_cancel)box.append(h('button',{type:'button',class:'menuitem danger',onclick:()=>{const r=prompt('เหตุผลที่ยกเลิก (จำเป็น)');if(r&&r.trim())move('cancelled','ยกเลิก',r.trim().slice(0,500))}},'ยกเลิกงาน…'));
  box.append(msg);return box;
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
    S.open?h('button',{type:'button',class:'sumbtn',onclick:ev=>makeSummary(o,ev.target)},'สรุปรายการเป็นรูป + QR'):null);
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
    refreshBadges()}catch(e){}
}
function openTeam(){
  S.team={messages:[],lastRead:0,els:null,sending:false};
  const ta=h('textarea',{rows:1,placeholder:'พิมพ์ถึงทีม…',oninput:()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';send.disabled=!ta.value.trim()}});
  const send=h('button',{type:'button',class:'send','aria-label':'ส่ง',disabled:true,onclick:sendTeam},'➤');
  const msgs=h('div',{class:'msgs'});
  const note=h('div',{class:'note err',style:'display:none'});
  S.team.els={ta,send,msgs,note};
  root.replaceChildren(h('div',{class:'bar'},logoImg(),h('h1',null,'ทีมแอดมิน')),menuTabs('team'),note,msgs,h('div',{class:'composer'},ta,send));
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
