// MangaView v1 → v2 迁移桥。
// v1 安装在 dist/，其 Service Worker 更新检查会取到本文件：立即接管，删除 v1 的缓存，
// 把仍打开着的 v1 页面带到新地址，然后注销自己。只要还可能有 v1 用户，就保留 dist/。
const target=new URL('../?from=v1',self.registration.scope).href;
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  // 缓存按源共享，只删除名字里带本作用域的（workbox 预缓存名含作用域 URL）。
  for(const key of await caches.keys())if(key.includes(self.registration.scope))await caches.delete(key);
  await self.clients.claim();
  const windows=await self.clients.matchAll({type:'window'});
  await Promise.all(windows.map(client=>client.navigate(target).catch(()=>{})));
  await self.registration.unregister();
})()));
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(Response.redirect(target,302));});
