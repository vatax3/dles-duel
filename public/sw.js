// Service worker minimal : rend l'app installable et garde la coquille hors ligne.
// Les données (/api/*) passent toujours par le réseau ; les pages toujours réseau d'abord.
const CACHE = 'duel-dles-__VERSION__';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const isPage = e.request.mode === 'navigate';
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(isPage ? '/' : e.request, copy)); }
    return res;
  }).catch(() => caches.match(isPage ? '/' : e.request).then(r => r || caches.match('/'))));
});
