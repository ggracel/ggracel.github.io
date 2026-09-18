/* foqs.habit service worker
   Served from /habit/ on GitHub Pages. Scope is /habit/ only.
   Cache name is unique so it never collides with the Ura+ app on the same origin. */
const CACHE = 'foqs-habit-v13';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './badge-96.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  /* Only handle our own origin. Google Fonts, the Supabase CDN and all API
     calls go straight to the network, untouched and uncached. */
  if (url.origin !== self.location.origin) return;

  /* Only handle files inside our own /habit/ scope, so we never interfere
     with the rest of foqs.si (including /uraplus). */
  const scope = new URL('./', self.location.href).pathname;
  if (!url.pathname.startsWith(scope)) return;

  /* The page itself must never come from the browser's HTTP cache, otherwise
     a deploy can take up to 10 minutes to show up. Assets may use it. */
  const isPage = req.mode === 'navigate'
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('.html');

  const netReq = isPage ? new Request(req.url, { cache: 'no-store' }) : req;

  /* Network first, fall back to cache when offline. */
  e.respondWith(
    fetch(netReq)
      .then(r => {
        if (r && r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return r;
      })
      .catch(() =>
        caches.match(req).then(m =>
          m || (req.mode === 'navigate' ? caches.match('./') : undefined)
        )
      )
  );
});

/* ── push reminders (Lights out) ──
   The server sends a small JSON payload: {title, body, tag, url}. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'foqs.habit', {
    body: d.body || '',
    tag: d.tag || 'foqs-habit',
    icon: './icon-192.png',
    badge: './badge-96.png',   /* monochrome, alpha only: Android paints it white in the status bar */
    data: { url: d.url || './' },
    renotify: false
  }));
});

/* Tapping the notification opens the app, or brings it to the front if it is already open. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const base = new URL('./', self.location.href).href;
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.location.href).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.startsWith(base) && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
