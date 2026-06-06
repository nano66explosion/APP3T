/* Service worker dédié aux notifications push Firebase (FCM) — Calendrier 3T.
   Reçoit les messages quand l'app est fermée / en arrière-plan.
   ⚠️ La config ci-dessous est PUBLIQUE (pas de secret) — elle doit être
   IDENTIQUE à FIREBASE_CONFIG dans calendrier_3T.html. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

if (FIREBASE_CONFIG.projectId) {
  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();

  // Message reçu alors que l'app est en arrière-plan / fermée
  messaging.onBackgroundMessage((payload) => {
    const n = (payload && payload.notification) || {};
    self.registration.showNotification(n.title || '🎭 3T TECH', {
      body: n.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: (payload && payload.data) || {}
    });
  });
}

// Clic sur la notification → ouvrir / focus l'app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('calendrier_3T.html');
    })
  );
});
