/* #16 — Envoi des notifications push (cron GitHub Actions quotidien).
   1) « 🎭 Régie demain »  : lit le planning publié par l'app (Firestore schedule/v1).
   2) « 🔒 Heures supp clôturées » : lit les fichiers heures supp sur Drive (via le
      compte de service) et notifie le régisseur dont l'onglet contient un STOP.
   firebase-admin contourne les règles Firestore. Les deux parties sont
   indépendantes : si l'une échoue (ex. Drive non partagé), l'autre fonctionne. */
const admin = require('firebase-admin');
const { google } = require('googleapis');
const XLSX = require('xlsx');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) { console.error('Secret FIREBASE_SERVICE_ACCOUNT manquant ou invalide.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const messaging = admin.messaging();

const APP_URL = 'https://nano66explosion.github.io/APP3T/calendrier_3T.html';
const HSUPP_FOLDER_ID = '1-HR96E9cjorFO9j9navxlQ1MKEVg9_7v';
const salleLbl = s => s === '3TC' ? '3T Côté' : s === 'GT' ? 'Grand Théâtre' : s;

// Régisseurs connus (doit rester aligné avec REGS dans l'app)
const REGS = [
  { nom: 'Maxime', v: ['maxime', 'max', 'maxi'] },
  { nom: 'JM', v: ['jm', 'j.m', 'j-m', 'jean-marc'] },
  { nom: 'Jules', v: ['jules'] },
  { nom: 'Théo', v: ['théo', 'theo'] },
  { nom: 'Simon', v: ['simon'] },
  { nom: 'Rizzo', v: ['rizzo'] },
  { nom: 'Charly', v: ['charly', 'charlie'] },
  { nom: 'Laurie', v: ['laurie', 'laure'] },
  { nom: 'Louis', v: ['louis'] },
];
// Nom d'onglet → régisseur (Rizzo prioritaire pour « Théo Rizzo »)
function regFromSheetName(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('rizzo')) return 'Rizzo';
  for (const r of REGS) { for (const v of r.v) { if (n.includes(v)) return r.nom; } }
  return null;
}

function isoInParis(offsetDays) {
  const paris = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  paris.setDate(paris.getDate() + offsetDays);
  const y = paris.getFullYear(), m = String(paris.getMonth() + 1).padStart(2, '0'), d = String(paris.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Jetons d'appareils groupés par régisseur, avec leurs préférences de notif.
async function getTokensByReg() {
  const map = {};                       // reg -> { token: prefs }
  (await db.collection('pushTokens').get()).forEach(doc => {
    const d = doc.data();
    if (d.reg && d.token) { (map[d.reg] = map[d.reg] || {})[d.token] = d.prefs || {}; }
  });
  return map;                           // dédoublonnage par clé token
}
// Jetons d'un régisseur qui acceptent le type `type` (activé par défaut).
function tokensFor(tokensByReg, reg, type) {
  const m = tokensByReg[reg] || {};
  return Object.keys(m).filter(tok => m[tok][type] !== false);
}

// Envoi multicast + nettoyage des jetons invalides.
// `tag` : notifications de même tag → fusionnées par l'OS (pas de doublon).
async function sendTo(tokens, title, body, link, tag) {
  if (!tokens.length) return 0;
  // DATA-ONLY (title/body/url/tag dans data) : le SW affiche lui-même la notif
  // (onBackgroundMessage) → fiable app fermée, y compris PWA iOS, sans doublon.
  const res = await messaging.sendEachForMulticast({
    tokens,
    data: { title: title || '', body: body || '', url: link || APP_URL, tag: tag || '3t' },
    webpush: { fcmOptions: { link: link || APP_URL } }
  });
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const c = r.error && r.error.code;
      if (c === 'messaging/registration-token-not-registered' || c === 'messaging/invalid-argument') {
        db.collection('pushTokens').doc(tokens[i]).delete().catch(() => {});
      }
    }
  });
  return res.successCount;
}

// ─── 1) Rappels « régie demain » ─────────────────────────────────────────────
async function remindTomorrow(tokensByReg) {
  // Le rappel « régie demain » ne part que le soir (17h–22h Paris), même si le
  // cron tourne plusieurs fois par jour (la détection STOP, elle, tourne à chaque run).
  const parisNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  if (parisNow.getHours() < 17 || parisNow.getHours() >= 22) {
    console.log('Régie demain — hors créneau du soir (17h–22h), on n\'envoie pas.');
    return;
  }
  const tomorrow = isoInParis(1);
  console.log('Régie demain — cible :', tomorrow);
  const snap = await db.collection('schedule').doc('v1').get();
  if (!snap.exists) { console.log('  Aucun planning publié (schedule/v1).'); return; }
  const entries = ((snap.data() || {}).days || {})[tomorrow] || [];
  if (!entries.length) { console.log('  Aucune régie demain.'); return; }

  const sentRef = db.collection('sentLog').doc('reminders-' + tomorrow);
  if ((await sentRef.get()).exists) { console.log('  Déjà envoyé pour', tomorrow); return; }

  const perReg = {};
  entries.forEach(e => (e.regs || []).forEach(reg => { (perReg[reg] = perReg[reg] || []).push(e); }));

  let total = 0;
  for (const [reg, list] of Object.entries(perReg)) {
    const body = list.map(e => `${e.spec} · ${salleLbl(e.salle)}${e.h ? ' ' + e.h : ''}`).join('\n');
    const n = await sendTo(tokensFor(tokensByReg, reg, 'regie'), '🎭 Régie demain', body, APP_URL + '#today', 'regie-' + tomorrow);
    total += n;
    console.log(`  ${reg}: ${n} envoyé(s)`);
  }
  await sentRef.set({ at: new Date().toISOString(), count: total });
}

// ─── 1bis) Rappel « bilan soirée » (~22h30 Paris) ────────────────────────────
async function remindSoiree(tokensByReg) {
  const parisNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  if (parisNow.getHours() < 22) { return; }   // seulement en fin de soirée
  const today = isoInParis(0);
  const snap = await db.collection('schedule').doc('v1').get();
  if (!snap.exists) return;
  const entries = ((snap.data() || {}).days || {})[today] || [];
  if (!entries.length) { console.log('Bilan soirée — aucune régie aujourd\'hui.'); return; }
  const sentRef = db.collection('sentLog').doc('soiree-' + today);
  if ((await sentRef.get()).exists) { console.log('Bilan soirée — déjà envoyé.'); return; }
  const perReg = {};
  entries.forEach(e => (e.regs || []).forEach(reg => { (perReg[reg] = perReg[reg] || []).push(e.spec); }));
  let total = 0;
  for (const [reg, specs] of Object.entries(perReg)) {
    const body = `N'oublie pas de donner le bilan sur WhatsApp 🎭 (${[...new Set(specs)].join(', ')})`;
    const n = await sendTo(tokensFor(tokensByReg, reg, 'soiree'), '💬 Bilan de soirée', body, APP_URL + '#soiree', 'soiree-' + today);
    total += n;
    console.log(`Bilan soirée ${reg}: ${n} envoyé(s)`);
  }
  await sentRef.set({ at: new Date().toISOString(), count: total });
}

// ─── 1ter) Nouvelles formations proposées → notifie les autres régisseurs ────
async function notifyFormations(tokensByReg) {
  const today = isoInParis(0);
  let snap;
  try { snap = await db.collection('formations').where('notified', '==', false).get(); }
  catch (e) { console.error('Formations : échec lecture Firestore —', e.message); return; }
  if (snap.empty) { console.log('Formations : aucune nouvelle à notifier.'); return; }
  console.log(`Formations : ${snap.size} non notifiée(s).`);
  for (const doc of snap.docs) {
    const f = doc.data();
    // Formation passée → on classe sans notifier.
    if (!f.date || f.date < today) { await doc.ref.update({ notified: true }).catch(() => {}); continue; }
    // destinataires = tous les jetons (sauf le créateur) qui acceptent les formations
    const tokens = [];
    for (const [reg, map] of Object.entries(tokensByReg)) {
      if (reg === f.by) continue;
      for (const [tok, prefs] of Object.entries(map)) { if (prefs.formation !== false) tokens.push(tok); }
    }
    const uniq = [...new Set(tokens)];
    // Aucun destinataire pour l'instant : on NE marque PAS notified → réessai au prochain run
    // (sinon la formation serait perdue si personne d'autre n'avait encore son app/jeton).
    if (!uniq.length) { console.log(`Formation "${f.subject}" (par ${f.by||'—'}) : 0 destinataire dispo, réessai au prochain run.`); continue; }
    const body = `${f.subject} le ${f.date}${f.time ? ' à ' + f.time : ''} (proposé par ${f.by || '—'})`;
    const n = await sendTo(uniq, '📚 Nouvelle formation', body, APP_URL + '#f-' + f.date, 'formation-' + doc.id);
    if (n > 0) await doc.ref.update({ notified: true }).catch(() => {});   // ne consomme que si vraiment envoyé
    console.log(`Formation "${f.subject}" → ${n}/${uniq.length} envoyé(s)${n ? '' : ' (non marquée, réessai)'}`);
  }
}

// ─── 2) Clôture heures supp (STOP) ───────────────────────────────────────────
async function checkStops(tokensByReg) {
  const auth = new google.auth.GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const drive = google.drive({ version: 'v3', auth });
  const list = await drive.files.list({
    q: `'${HSUPP_FOLDER_ID}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType)', pageSize: 200,
    supportsAllDrives: true, includeItemsFromAllDrives: true
  });
  const files = (list.data.files || []).filter(f => {
    if (f.mimeType === 'application/vnd.google-apps.folder') return false;   // ignore les sous-dossiers (ex. "heures 25-26")
    const n = (f.name || '').toUpperCase();
    return n.includes('HEURE') && !n.includes('BASE');
  });
  console.log('STOP — fichiers heures supp trouvés :', files.length);

  for (const f of files) {
    let buf;
    if (f.mimeType === 'application/vnd.google-apps.spreadsheet') {
      const r = await drive.files.export({ fileId: f.id, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' });
      buf = Buffer.from(r.data);
    } else {
      const r = await drive.files.get({ fileId: f.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
      buf = Buffer.from(r.data);
    }
    const wb = XLSX.read(buf, { type: 'buffer' });
    for (const sheetName of wb.SheetNames) {
      const reg = regFromSheetName(sheetName);
      if (!reg) continue;
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: true });
      let stopText = null;
      for (const row of rows) {
        const motif = String(row[3] || '').trim();
        if (/STOP/i.test(motif)) { stopText = motif; break; }
      }
      if (!stopText) continue;

      const ref = db.collection('stops').doc(`${f.id}__${reg}`);
      const prev = await ref.get();
      if (prev.exists && prev.data().stopText === stopText) continue;  // déjà notifié

      const n = await sendTo(tokensFor(tokensByReg, reg, 'stop'), '🔒 Heures supp clôturées', `${f.name} — ${stopText}`, APP_URL, 'stop-' + reg + '-' + f.id);
      await ref.set({ reg, file: f.name, stopText, at: new Date().toISOString() });
      console.log(`  STOP ${reg} (${f.name}) → ${n} envoyé(s)`);
    }
  }
}

(async () => {
  const tokensByReg = await getTokensByReg();
  try { await remindTomorrow(tokensByReg); }
  catch (e) { console.error('Erreur rappels régie demain :', e.message); }
  try { await remindSoiree(tokensByReg); }
  catch (e) { console.error('Erreur rappel bilan soirée :', e.message); }
  try { await notifyFormations(tokensByReg); }
  catch (e) { console.error('Erreur notif formations :', e.message); }
  try { await checkStops(tokensByReg); }
  catch (e) { console.error('Erreur détection STOP (Drive partagé avec le compte de service ?) :', e.message); }
})().catch(e => { console.error(e); process.exit(1); });
