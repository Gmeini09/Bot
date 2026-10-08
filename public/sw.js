// SP Tool service worker: caches the app shell so the PWA works offline.
// 1.9.0-muz7i68q is replaced at build time; a new version replaces the old cache.
const CACHE = 'sptool-1.9.0-muz7i68q';
const SHELL = ['./', 'index.html', 'main.js', 'audio.worker.js', 'app.css', 'manifest.webmanifest',
  'assets/logo.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/maskable-512.png', 'assets/icons/icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('sptool-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first for navigations (fresh UI when online), cache first for static files.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const u = new URL(req.url);
  // Never cache API calls (license server may share the origin).
  if (req.method !== 'GET' || u.origin !== self.location.origin || u.pathname.includes('/api/') || u.pathname.startsWith('/native/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
