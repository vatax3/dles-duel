// Service worker minimal : rend l'app installable et garde la coquille hors ligne.
// Les données (/api/*) passent toujours par le réseau.
const CACHE = 'duel-dles-v2';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/games.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Réseau d'abord (pour toujours avoir la dernière version), cache en secours
  e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(url.pathname === '/' ? '/' : e.request, copy)); return res; })
    .catch(() => caches.match(url.pathname === '/' || url.search ? '/' : e.request).then(r => r || caches.match('/'))));
});
