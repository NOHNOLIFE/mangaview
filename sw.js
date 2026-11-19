// 发布时与 index.html 的 <title> 版本号一起修改；不 skipWaiting，阅读中的窗口保持使用完整旧版本。
const prefix='mangaview-shell:'+self.registration.scope+':', cacheName=prefix+'2.0.0';
const shell=['index.html','style.css','app.mjs','model.mjs','lang.mjs','store.mjs','sources.mjs','view.mjs','app.webmanifest','icons/192.png','icons/512.png'].map(p=>new URL(p,self.registration.scope).href);
self.addEventListener('install',e=>e.waitUntil((async()=>{
  const cache=await caches.open(cacheName);
  await cache.addAll(shell.map(url=>new Request(url,{cache:'reload'})));
})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(prefix)&&key!==cacheName)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);url.hash='';url.search='';
  const key=url.href===self.registration.scope?shell[0]:url.href;
  if(shell.includes(key))e.respondWith(caches.open(cacheName).then(async cache=>(await cache.match(key))||fetch(e.request)));
});
