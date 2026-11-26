// 发布时与 index.html 的 <title> 版本号一起修改；不 skipWaiting，阅读中的窗口保持使用完整旧版本。
const prefix = 'mangaview-shell:' + self.registration.scope + ':',
  cacheName = prefix + '2.3.0';
const shell = [
    'app.webmanifest',
    'icons/192.png',
    'icons/512.png',
    'index.html',
    'src/app.mjs',
    'src/core/books.mjs',
    'src/core/events.mjs',
    'src/core/lang.mjs',
    'src/core/locale.mjs',
    'src/core/match.mjs',
    'src/core/merge.mjs',
    'src/core/model.mjs',
    'src/core/normalize.mjs',
    'src/core/playlist.mjs',
    'src/core/prefs.mjs',
    'src/core/sections.mjs',
    'src/core/sources.mjs',
    'src/core/status.mjs',
    'src/core/store.mjs',
    'src/core/windows.mjs',
    'src/marks/bookmarks.css',
    'src/marks/bookmarks.mjs',
    'src/marks/pbf.mjs',
    'src/media/media.css',
    'src/media/media.mjs',
    'src/panels/backup.mjs',
    'src/panels/help.css',
    'src/panels/help.mjs',
    'src/panels/settings.css',
    'src/panels/settings.mjs',
    'src/reader/actions.mjs',
    'src/reader/drag.mjs',
    'src/reader/endbar.mjs',
    'src/reader/focus.css',
    'src/reader/focus.mjs',
    'src/reader/keys.mjs',
    'src/reader/overview.css',
    'src/reader/overview.mjs',
    'src/reader/panel.mjs',
    'src/reader/session.mjs',
    'src/reader/shell.mjs',
    'src/reader/sort.mjs',
    'src/reader/tap.mjs',
    'src/reader/thumbs.mjs',
    'src/reader/toolbar.css',
    'src/reader/toolbar.mjs',
    'src/reader/view.mjs',
    'src/shelf/cover.mjs',
    'src/shelf/drop.mjs',
    'src/shelf/import.mjs',
    'src/shelf/pick.mjs',
    'src/shelf/refresh.mjs',
    'src/shelf/relink.mjs',
    'src/shelf/remove.mjs',
    'src/shelf/shelf.css',
    'src/shelf/shelf.mjs',
    'src/style.css',
    'src/ui/dom.mjs',
  ].map((p) => new URL(p, self.registration.scope).href),
  index = new URL('index.html', self.registration.scope).href;
self.addEventListener('install', (e) =>
  e.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      await cache.addAll(shell.map((url) => new Request(url, { cache: 'reload' })));
    })(),
  ),
);
self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  url.hash = '';
  url.search = '';
  const key = url.href === self.registration.scope ? index : url.href;
  if (shell.includes(key))
    e.respondWith(caches.open(cacheName).then(async (cache) => (await cache.match(key)) || fetch(e.request)));
});
