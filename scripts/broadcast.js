/* #16 — Notification manuelle à toute l'équipe (broadcast).
   Lancé depuis GitHub Actions (workflow_dispatch) avec un titre + un message.
   Envoie à tous les appareils enregistrés dans Firestore (pushTokens). */
const admin = require('firebase-admin');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) { console.error('Secret FIREBASE_SERVICE_ACCOUNT manquant ou invalide.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const messaging = admin.messaging();

const APP_URL = 'https://nano66explosion.github.io/APP3T/calendrier_3T.html';
const title = (process.env.TITLE || '📣 Info équipe').trim();
const body = (process.env.BODY || '').trim();

(async () => {
  if (!body) { console.error('Message vide.'); process.exit(1); }

  const set = new Set();
  (await db.collection('pushTokens').get()).forEach(doc => {
    const d = doc.data();
    if (d.token && (!d.prefs || d.prefs.info !== false)) set.add(d.token);   // respecte la pref "Infos équipe"
  });
  const tokens = [...set];   // dédoublonnage des jetons identiques
  if (!tokens.length) { console.log('Aucun appareil enregistré.'); return; }
  console.log('Jetons uniques :', tokens.length);

  const tag = 'broadcast-' + Date.now();   // même tag pour cet envoi → pas de doublon affiché
  let sent = 0;
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const res = await messaging.sendEachForMulticast({
      tokens: batch,
      // DATA-ONLY : affichage par le SW (onBackgroundMessage) → fiable app fermée / iOS.
      data: { title: title || '', body: body || '', url: APP_URL, tag },
      webpush: { fcmOptions: { link: APP_URL } }
    });
    sent += res.successCount;
    res.responses.forEach((r, j) => {
      if (!r.success) {
        const c = r.error && r.error.code;
        if (c === 'messaging/registration-token-not-registered' || c === 'messaging/invalid-argument') {
          db.collection('pushTokens').doc(batch[j]).delete().catch(() => {});
        }
      }
    });
  }
  console.log(`Envoyé à ${sent}/${tokens.length} appareil(s).`);
})().catch(e => { console.error(e); process.exit(1); });
