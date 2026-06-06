/* Service worker dédié aux notifications push Firebase (FCM) — Calendrier 3T.
   Reçoit les messages quand l'app est fermée / en arrière-plan.
   ⚠️ La config ci-dessous est PUBLIQUE (pas de secret) — elle doit être
   IDENTIQUE à FIREBASE_CONFIG dans calendrier_3T.html. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

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

  // Message en arrière-plan / app fermée.
  // Les messages avec une charge "notification" sont affichés automatiquement
  // par Firebase, et le clic ouvre le lien défini dans webpush.fcmOptions.link
  // (ex. .../calendrier_3T.html#today). On ne définit donc PAS de gestionnaire
  // notificationclick ici : Firebase s'en charge et respecte ce lien.
}
