// Push only (roadmap 6-5): no fetch handler and no cache, so a new publish always reaches the phone.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
// The push carries no text; every push must show a notification or iOS stops delivering them.
self.addEventListener('push',e=>{
  e.waitUntil(self.registration.showNotification('Standby.y',{body:'มีข้อความลูกค้าใหม่',tag:'new-message',renotify:true,icon:'icon-192.png'}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil((async()=>{
    const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of all){if('focus' in c){c.postMessage({type:'notif'});return c.focus()}}
    return self.clients.openWindow('./?n=1');
  })());
});
