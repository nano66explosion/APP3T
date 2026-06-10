// Service worker — Calendrier 3T (PWA)
// ⚠️ Bumper ce numéro à CHAQUE release (app.js/style.css/html) : c'est le changement
// de sw.js qui déclenche la mise à jour auto (install → skipWaiting → activate →
// controllerchange → location.reload). Sans ça, les PWA (surtout iOS) gardent l'ancienne version.
const CACHE = '3t-cache-v16';
const ASSETS = [
  'calendrier_3T.html',
  'app.js',
  'style.css',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'logo.png'
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
      .catch(() => caches.match(req, { ignoreSearch: true }).then(m =>
        m || (req.mode === 'navigate' ? caches.match('calendrier_3T.html') : undefined)
      ))
  );
});

// Clic sur une notification → focus la fenêtre + VA À LA BONNE PAGE (#f-<date>, #today, #soiree).
// sw.js contrôle la page (scope racine) → navigate() marche directement ici.
function _notifUrl(n){
  const d = (n && n.data) || {};
  const m = d.FCM_MSG || {};
  return d.url || d.link
    || (m.data && (m.data.url || m.data.link))
    || (m.notification && m.notification.click_action)
    || (m.webpush && m.webpush.fcmOptions && m.webpush.fcmOptions.link)
    || (m.fcmOptions && m.fcmOptions.link)
    || 'calendrier_3T.html';
}
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = _notifUrl(e.notification);
  const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.includes('calendrier_3T.html')) {
        try { await c.focus(); } catch (err) {}
        if (hash) {
          try { await c.navigate(url); }                                   // recharge/hashchange → handleNotifNav
          catch (err) { try { c.postMessage({ type: 'notif-nav', hash }); } catch (e2) {} }
        }
        return;
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
