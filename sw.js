// Service worker — Calendrier 3T (PWA)
const CACHE = '3t-cache-v2';
const ASSETS = [
  'calendrier_3T.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];
// Libs externes (CDN) — pré-cachées pour que l'app fonctionne hors-ligne
const CDN = [
  'https://apis.google.com/js/api.js',
  'https://accounts.google.com/gsi/client',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS).catch(() => {});
    // Best-effort : on tente de mettre les libs CDN en cache (ne bloque pas l'install)
    await Promise.all(CDN.map(u =>
      fetch(u, { mode: 'no-cors' }).then(r => c.put(u, r)).catch(() => {})
    ));
    self.skipWaiting();
  })());
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
  // Réseau d'abord (pour avoir les mises à jour), cache en secours hors-ligne.
  // On met en cache au passage (même origine ET CDN) pour la consultation sans réseau.
  e.respondWith(
    fetch(req)
      .then(r => {
        const cp = r.clone();
        caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
        return r;
      })
      .catch(() => caches.match(req).then(m =>
        m || (req.mode === 'navigate' ? caches.match('calendrier_3T.html') : undefined)
      ))
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
