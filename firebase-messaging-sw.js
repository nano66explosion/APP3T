/* Service worker dédié aux notifications push Firebase (FCM) — Calendrier 3T.
   Reçoit les messages quand l'app est fermée / en arrière-plan.
   ⚠️ La config ci-dessous est PUBLIQUE (pas de secret) — elle doit être
   IDENTIQUE à FIREBASE_CONFIG dans calendrier_3T.html. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Force la nouvelle version du service worker à prendre le relais immédiatement
// (évite qu'une ancienne version continue d'afficher les notifs en double).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ── Clic sur une notif : focus la fenêtre déjà ouverte + va à la bonne page ──
// Enregistré AVANT firebase.messaging() pour passer devant le gestionnaire par
// défaut de Firebase (stopImmediatePropagation), sinon le clic remettait juste
// l'app au premier plan sans changer le hash (ex. #f-<date>) → on restait sur place.
function _targetUrl(n){
  const d = (n && n.data) || {};
  const m = d.FCM_MSG || {};
  return d.url || d.link
    || (m.data && (m.data.url || m.data.link))
    || (m.notification && m.notification.click_action)
    || (m.webpush && m.webpush.fcmOptions && m.webpush.fcmOptions.link)
    || (m.fcmOptions && m.fcmOptions.link)
    || '';
}
self.addEventListener('notificationclick', (event) => {
  event.stopImmediatePropagation();
  event.notification.close();
  const url = _targetUrl(event.notification) || '/APP3T/calendrier_3T.html';
  const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('calendrier_3T.html')) {
        try { await c.focus(); } catch (e) {}
        if (hash) {
          try { await c.navigate(url); }                                   // si possible (page contrôlée)
          catch (e) { try { c.postMessage({ type: 'notif-nav', hash }); } catch (e2) {} }   // sinon message à la page
        }
        return;
      }
    }
    if (self.clients.openWindow) { try { await self.clients.openWindow(url); } catch (e) {} }
  })());
});

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDXOF7_eTKMDYp8swxmoznEfyxY8_4ArP0",
  authDomain: "tapp-2c0a8.firebaseapp.com",
  projectId: "tapp-2c0a8",
  storageBucket: "tapp-2c0a8.firebasestorage.app",
  messagingSenderId: "960662160605",
  appId: "1:960662160605:web:ea08946dca820ba381c734"
};

if (FIREBASE_CONFIG.projectId) {
  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();

  // Message en arrière-plan / app fermée. Les envois portent désormais un bloc
  // `notification` (webpush) → REQUIS sur iOS pour un push user-visible affiché app
  // fermée. Quand ce bloc est présent, le SDK Firebase affiche LUI-MÊME la notif :
  // on ne fait donc RIEN ici (sinon doublon). On ne s'affiche soi-même qu'en repli
  // pour d'éventuels anciens messages DATA-ONLY encore en file (sans `notification`).
  messaging.onBackgroundMessage((payload) => {
    if (payload && payload.notification) return;   // le SDK l'affiche → pas de doublon
    const d = (payload && payload.data) || {};
    return self.registration.showNotification(d.title || '🎭 3T TECH', {
      body: d.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: d.tag || '3t',
      data: { url: d.url || '' }
    });
  });
}
