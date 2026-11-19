/* BarTill service worker – offline app shell + image cache. No external requests. */
const SHELL = 'bartill-shell-v16';
const RUNTIME = 'bartill-runtime-v16';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/Login_bg.webp', '/Login_logo.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, RUNTIME].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // API: always network (the app keeps its own IndexedDB cache / queue)
  if (url.pathname.startsWith('/api/')) return;
  // Navigations: network first, fall back to cached shell (SPA)
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { caches.open(SHELL).then((c) => c.put('/', res.clone())); return res; }).catch(() => caches.match('/')));
    return;
  }
  // Static assets & uploaded images: stale-while-revalidate
  e.respondWith(caches.open(RUNTIME).then(async (cache) => {
    const cached = await cache.match(req);
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
    return cached || net;
  }));
});
