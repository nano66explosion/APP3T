/* #16 — Envoi des rappels push « Régie demain » (cron GitHub Actions).
   Lit le planning publié par l'app dans Firestore (schedule/v1) + les jetons
   d'appareils (pushTokens), et envoie une notif FCM à chaque régisseur ayant
   une régie le lendemain. firebase-admin contourne les règles Firestore. */
const admin = require('firebase-admin');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) {
  console.error('Secret FIREBASE_SERVICE_ACCOUNT manquant ou invalide.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const messaging = admin.messaging();

const APP_URL = 'https://nano66explosion.github.io/APP3T/calendrier_3T.html';
const salleLbl = s => s === '3TC' ? '3T Côté' : s === 'GT' ? 'Grand Théâtre' : s;

// Date ISO (Europe/Paris) décalée de `offsetDays` jours
function isoInParis(offsetDays) {
  const paris = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  paris.setDate(paris.getDate() + offsetDays);
  const y = paris.getFullYear(), m = String(paris.getMonth() + 1).padStart(2, '0'), d = String(paris.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

(async () => {
  const tomorrow = isoInParis(1);
  console.log('Cible (demain) :', tomorrow);

  const snap = await db.collection('schedule').doc('v1').get();
  if (!snap.exists) { console.log('Aucun planning publié (schedule/v1).'); return; }
  const days = (snap.data() || {}).days || {};
  const entries = days[tomorrow] || [];
  if (!entries.length) { console.log('Aucune régie demain.'); return; }

  // Anti-doublon : un seul envoi par jour
  const sentRef = db.collection('sentLog').doc('reminders-' + tomorrow);
  if ((await sentRef.get()).exists) { console.log('Déjà envoyé pour', tomorrow); return; }

  // Regroupe les régies par régisseur
  const perReg = {};
  entries.forEach(e => (e.regs || []).forEach(reg => { (perReg[reg] = perReg[reg] || []).push(e); }));

  // Récupère les jetons par régisseur
  const tokensByReg = {};
  (await db.collection('pushTokens').get()).forEach(doc => {
    const d = doc.data();
    if (d.reg && d.token) (tokensByReg[d.reg] = tokensByReg[d.reg] || []).push(d.token);
  });

  let totalSent = 0;
  for (const [reg, list] of Object.entries(perReg)) {
    const tokens = tokensByReg[reg] || [];
    if (!tokens.length) { console.log(`${reg}: aucun appareil enregistré`); continue; }
    const body = list.map(e => `${e.spec} · ${salleLbl(e.salle)}${e.h ? ' ' + e.h : ''}`).join('\n');
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: '🎭 Régie demain', body },
      webpush: { fcmOptions: { link: APP_URL } }
    });
    totalSent += res.successCount;
    // Nettoie les jetons devenus invalides
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
          db.collection('pushTokens').doc(tokens[i]).delete().catch(() => {});
        }
      }
    });
    console.log(`${reg}: ${res.successCount}/${tokens.length} envoyé(s)`);
  }

  await sentRef.set({ at: new Date().toISOString(), count: totalSent });
  console.log('Total envoyé :', totalSent);
})().catch(e => { console.error(e); process.exit(1); });
