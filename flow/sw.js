/* foqs. flow service worker. Scope is /flow/ only, cache name is unique. */
const CACHE = 'foqs-flow-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('foqs-flow-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;            /* Supabase, fonts and CDN go straight to the network */
  const scope = new URL('./', self.location.href).pathname;
  if (!url.pathname.startsWith(scope)) return;                 /* never touch the rest of foqs.si */
  e.respondWith(fetch(req).then(r => { if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); } return r; })
    .catch(() => caches.match(req).then(m => m || (req.mode === 'navigate' ? caches.match('./') : undefined))));
});
