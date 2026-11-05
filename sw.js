/* Кешує лише оболонку застосунку; дані зберігаються окремо в localStorage. Також показує нагадування (Web Push). */
const CACHE = 'zoshyt-v9';
const SHELL = ['./', 'index.html', 'style.css?v=9', 'app.js?v=9', 'silence.js?v=9', 'files.js?v=9', 'board.js?v=9', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then((r) => {
      const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* ignore */ }
  e.waitUntil(self.registration.showNotification(d.title || 'Зошит', {
    body: d.body || 'Відкрийте зошит.', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || 'hw-reminder', renotify: true,
    requireInteraction: d.tag === 'silence',
    data: { url: d.url || './?tab=tasks', msg: d.msg || { tab: 'tasks' } },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const url = data.url || './?tab=tasks';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) { c.postMessage(data.msg || { tab: 'tasks' }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
