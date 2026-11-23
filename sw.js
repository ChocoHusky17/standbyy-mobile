// Push only (roadmap 6-5): no fetch handler and no cache, so a new publish always reaches the phone.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
// The push carries no text; every push must show a notification or iOS stops delivering them.
// The push carries (encrypted) the customer's name, a short preview and the chat id; an empty push still shows a generic notice.
// Every push must show a notification or iOS stops delivering them.
self.addEventListener('push',e=>{
  let d=null;try{d=e.data?e.data.json():null}catch(x){}
  const title=(d&&d.t)||'Standby.y',body=(d&&d.b)||'มีข้อความลูกค้าใหม่',chat=(d&&d.c)||'';
  e.waitUntil(self.registration.showNotification(title,{body,tag:chat?'chat-'+chat:'new-message',renotify:true,icon:'icon-192.png',data:{chat}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const chat=(e.notification.data&&e.notification.data.chat)||'';
  e.waitUntil((async()=>{
    const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of all){if('focus' in c){c.postMessage({type:'notif',chat});return c.focus()}}
    return self.clients.openWindow('./?n=1'+(chat?'&chat='+encodeURIComponent(chat):''));
  })());
});
