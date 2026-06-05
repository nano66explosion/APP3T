// Service worker — Calendrier 3T (PWA)
const CACHE = '3t-cache-v1';
const ASSETS = [
  'calendrier_3T.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // On ne touche pas aux requêtes externes (Google APIs, CDN) : réseau normal.
  if (url.origin !== location.origin) return;
  // Même origine : réseau d'abord (pour avoir les mises à jour), cache en secours hors-ligne.
  e.respondWith(
    fetch(req)
      .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r; })
      .catch(() => caches.match(req).then(m => m || caches.match('calendrier_3T.html')))
  );
});

// Clic sur une notification → ouvrir / focus l'app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('calendrier_3T.html');
    })
  );
});
