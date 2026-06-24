/* ───────────────────────────────────────────────────────────────────────────
   Cloudflare Worker — Notification INSTANTANÉE de formation (3T TECH)
   ----------------------------------------------------------------------------
   L'app (calendrier_3T.html) appelle ce Worker dès qu'une formation est créée :
     POST  https://<ton-worker>.workers.dev/   body: { "id": "<idDuDocFirestore>" }

   Le Worker :
     1. lit la formation dans Firestore (par son id),
     2. lit les jetons push (collection pushTokens) et garde les destinataires
        (≠ créateur, qui acceptent les formations),
     3. envoie le push FCM (HTTP v1) à chacun — EN QUELQUES SECONDES,
     4. marque la formation notified:true (anti-doublon avec le cron de secours).

   La clé d'envoi (compte de service Firebase) reste un SECRET du Worker :
   elle n'est JAMAIS exposée dans l'app. Anti-abus : le Worker ne notifie que
   pour une formation qui existe vraiment et n'est pas déjà notifiée.

   SECRET à définir (Cloudflare → Settings → Variables → Add secret) :
     FIREBASE_SERVICE_ACCOUNT = (le JSON complet du compte de service, identique
     au secret GitHub du même nom).
   ─────────────────────────────────────────────────────────────────────────── */

const APP_URL = 'https://nano66explosion.github.io/APP3T/calendrier_3T.html';
const FS = 'https://firestore.googleapis.com/v1/projects/';
// Identifiants publics (déjà exposés dans l'app) — pour la session Drive persistante.
const GOOGLE_CLIENT_ID = '960662160605-0br3e3mo6en3hgeqsrn6tuhi9t8cana7.apps.googleusercontent.com';
const FIREBASE_API_KEY = 'AIzaSyDXOF7_eTKMDYp8swxmoznEfyxY8_4ArP0';

// Origines autorisées (le site PWA). Bloque l'abus cross-site depuis un navigateur.
// NB : un client non-navigateur (curl) peut forger l'en-tête Origin → barrière
// légère, pas une authentification. La vraie protection = le secret du compte de
// service (jamais exposé) + le fait que seules les formations réelles non notifiées
// déclenchent un envoi.
const ALLOWED_ORIGINS = [
  'https://nano66explosion.github.io',
  'http://localhost',
  'http://127.0.0.1'
];
function originAllowed(origin) {
  if (!origin) return true;                       // app installée / service worker : pas d'Origin → toléré
  return ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), origin);
    if (request.method !== 'POST')   return cors(json({ error: 'POST only' }, 405), origin);
    if (!originAllowed(origin))       return cors(json({ error: 'origin refusée' }, 403), origin);

    let body;
    try { body = await request.json(); } catch (e) { return cors(json({ error: 'bad json' }, 400), origin); }

    // ── Échange d'identité : jeton Google → jeton sur-mesure Firebase ──────────
    // L'app envoie son access_token Google ; on vérifie l'identité via userinfo,
    // puis on signe un custom token Firebase (RS256, clé du compte de service).
    // Permet d'ouvrir une session Firebase Auth en PWA iOS (sans popup/redirect).
    if (body && body.action === 'firebaseToken') {
      const gtoken = body.googleAccessToken;
      if (!gtoken) return cors(json({ error: 'missing token' }, 400), origin);
      let saA;
      try { saA = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); }
      catch (e) { return cors(json({ error: 'service account manquant/invalide' }, 500), origin); }
      try {
        const ui = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: 'Bearer ' + gtoken }
        });
        if (!ui.ok) return cors(json({ error: 'jeton Google invalide' }, 401), origin);
        const info = await ui.json();
        if (!info || !info.sub) return cors(json({ error: 'identité Google introuvable' }, 401), origin);
        const ct = await makeFirebaseCustomToken(saA, 'g_' + info.sub, {
          email: info.email || '', name: info.name || ''
        });
        return cors(json({ token: ct, email: info.email || '' }), origin);
      } catch (e) {
        return cors(json({ error: String((e && e.message) || e) }, 500), origin);
      }
    }

    // ── Session Drive persistante : échange code OAuth ↔ refresh token (KV) ──────
    // Le refresh token reste côté Worker (jamais renvoyé à l'app).
    if (body && (body.action === 'exchangeCode' || body.action === 'refreshToken')) {
      if (!env.GOOGLE_CLIENT_SECRET || !env.TOKENS) {
        return cors(json({ error: 'persistance non configurée' }, 501), origin);
      }
      try {
        if (body.action === 'exchangeCode') {
          // L'identité (uid) est dérivée du jeton fraîchement obtenu (userinfo → sub).
          if (!body.code) return cors(json({ error: 'missing code' }, 400), origin);
          // Dédoublonnage du callback iOS (PWA + navigateur interne échangent le MÊME code) :
          // si ce code a déjà été échangé, on renvoie le résultat caché au lieu d'un invalid_grant.
          const ck = 'code:' + body.code;
          const cached = await env.TOKENS.get(ck);
          if (cached) return cors(json(JSON.parse(cached)), origin);
          const d = await googleToken({
            grant_type: 'authorization_code',
            code: body.code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: body.redirectUri || 'postmessage'
          });
          if (!d.access_token) return cors(json({ error: 'échange code: ' + JSON.stringify(d) }, 400), origin);
          if (d.refresh_token) {
            const ui = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: 'Bearer ' + d.access_token }
            });
            const info = ui.ok ? await ui.json() : null;
            if (info && info.sub) await env.TOKENS.put('rt:g_' + info.sub, d.refresh_token);
          }
          const result = { access_token: d.access_token, expires_in: d.expires_in || 3600, has_refresh: !!d.refresh_token };
          await env.TOKENS.put(ck, JSON.stringify(result), { expirationTtl: 300 });   // cache 5 min (dédoublonnage)
          return cors(json(result), origin);
        } else {
          // Rafraîchissement silencieux : protégé par le jeton d'identité Firebase.
          const uid = await verifyFirebaseIdToken(body.firebaseIdToken);
          if (!uid) return cors(json({ error: 'auth requise' }, 401), origin);
          const rt = await env.TOKENS.get('rt:' + uid);
          if (!rt) return cors(json({ error: 'no_refresh' }, 404), origin);
          const d = await googleToken({
            grant_type: 'refresh_token',
            refresh_token: rt,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET
          });
          if (!d.access_token) {
            if (d.error === 'invalid_grant') await env.TOKENS.delete('rt:' + uid);  // révoqué/expiré
            return cors(json({ error: 'refresh: ' + (d.error || 'fail') }, 400), origin);
          }
          return cors(json({ access_token: d.access_token, expires_in: d.expires_in || 3600 }), origin);
        }
      } catch (e) {
        return cors(json({ error: String((e && e.message) || e) }, 500), origin);
      }
    }

    // ── Notification générique (réunion confirmée, nouvelle note…) ─────────────
    // Protégée par le jeton d'identité Firebase. Push à tous les jetons (hors
    // excludeReg), en respectant la préférence `pref` si fournie.
    if (body && body.action === 'notify') {
      const uid = await verifyFirebaseIdToken(body.firebaseIdToken);
      if (!uid) return cors(json({ error: 'auth requise' }, 401), origin);
      const title = (body.title || '3T TECH').slice(0, 120);
      const text  = (body.body || '').slice(0, 300);
      if (!text) return cors(json({ error: 'missing body' }, 400), origin);
      let saN;
      try { saN = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); }
      catch (e) { return cors(json({ error: 'service account manquant/invalide' }, 500), origin); }
      const pidN = saN.project_id;
      try {
        const tok = await getAccessToken(saN);
        const docs = await firestoreList(pidN, tok, 'pushTokens');
        const pref = body.pref || '', excl = body.excludeReg || '';
        const tokens = [];
        for (const d of docs) {
          const v = parseFields(d.fields || {});
          if (!v.token) continue;
          if (excl && v.reg && v.reg === excl) continue;
          if (pref && (v.prefs || {})[pref] === false) continue;
          tokens.push(v.token);
        }
        const uniq = [...new Set(tokens)];
        const link = body.url ? (APP_URL + body.url) : APP_URL;
        const tag = (body.tag || 'info').slice(0, 60);
        let sent = 0;
        for (const tk of uniq) {
          const r = await fcmSend(pidN, tok, tk, title, text, link, tag);
          if (r.ok) sent++;
        }
        return cors(json({ ok: true, sent, recipients: uniq.length }), origin);
      } catch (e) {
        return cors(json({ error: String((e && e.message) || e) }, 500), origin);
      }
    }

    const id = body && body.id;
    if (!id) return cors(json({ error: 'missing id' }, 400), origin);

    let sa;
    try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); }
    catch (e) { return cors(json({ error: 'service account manquant/invalide' }, 500)); }
    const pid = sa.project_id;

    try {
      const token = await getAccessToken(sa);

      // 1) La formation existe-t-elle et est-elle à notifier ?
      const fdoc = await firestoreGet(pid, token, `formations/${id}`);
      if (!fdoc) return cors(json({ error: 'formation introuvable' }, 404));
      const f = parseFields(fdoc.fields);
      if (f.notified === true) return cors(json({ ok: true, skipped: 'déjà notifiée' }));

      const today = new Date().toISOString().slice(0, 10);
      if (!f.date || f.date < today) {
        await firestorePatch(pid, token, `formations/${id}`, { notified: true });
        return cors(json({ ok: true, skipped: 'date passée' }));
      }

      // 2) Destinataires (≠ créateur, qui acceptent les formations)
      const docs = await firestoreList(pid, token, 'pushTokens');
      const tokens = [];
      for (const d of docs) {
        const v = parseFields(d.fields || {});
        if (!v.token) continue;
        if (v.reg && f.by && v.reg === f.by) continue;          // pas le créateur
        const prefs = v.prefs || {};
        if (prefs.formation === false) continue;                // respecte la préférence
        tokens.push(v.token);
      }
      const uniq = [...new Set(tokens)];
      if (!uniq.length) return cors(json({ ok: true, sent: 0, note: 'aucun destinataire' }));

      // 3) Envoi FCM (HTTP v1), un message par jeton
      const title = '📚 Nouvelle formation';
      const text  = `${f.subject} le ${f.date}${f.time ? ' à ' + f.time : ''} (proposé par ${f.by || '—'})`;
      const link  = APP_URL + '#f-' + f.date;
      let sent = 0;
      const dead = [];
      for (const tk of uniq) {
        const r = await fcmSend(pid, token, tk, title, text, link, 'formation-' + id);
        if (r.ok) sent++;
        else if (r.gone) dead.push(tk);                          // jeton invalide → nettoyage
      }

      // 4) Anti-doublon : on marque seulement si au moins 1 envoi a réussi
      if (sent > 0) await firestorePatch(pid, token, `formations/${id}`, { notified: true });

      return cors(json({ ok: true, sent, recipients: uniq.length, dead: dead.length }));
    } catch (e) {
      return cors(json({ error: String(e && e.message || e) }, 500));
    }
  },

  // ── CRON Cloudflare (fiable, contrairement au cron GitHub qui tourne avec des
  // heures de retard) : rappel « bilan de soirée » ~22h Paris.
  // Configurer 2 Cron Triggers (couvre été/hiver) : "15 20 * * *" et "15 21 * * *".
  // Le contrôle d'heure Paris + l'anti-doublon sentLog évitent tout double envoi.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(soireeReminder(env));
  }
};

/* ── Rappel bilan de soirée (porté de scripts/send-reminders.js) ─────────────── */
async function soireeReminder(env) {
  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); } catch (e) { return; }
  const pid = sa.project_id;
  const paris = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  if (paris.getHours() < 22) return;                       // fin de soirée seulement
  const today = `${paris.getFullYear()}-${String(paris.getMonth() + 1).padStart(2, '0')}-${String(paris.getDate()).padStart(2, '0')}`;
  const token = await getAccessToken(sa);
  // Anti-doublon (même clé que le cron GitHub → pas de double envoi entre les deux)
  const sent = await firestoreGet(pid, token, `sentLog/soiree-${today}`);
  if (sent) return;
  const sdoc = await firestoreGet(pid, token, 'schedule/v1');
  if (!sdoc) return;
  const days = (parseFields(sdoc.fields) || {}).days || {};
  const entries = days[today] || [];
  if (!entries.length) return;
  // Jetons par régisseur (préférence « soiree » respectée)
  const docs = await firestoreList(pid, token, 'pushTokens');
  const tokensByReg = {};
  for (const d of docs) {
    const v = parseFields(d.fields || {});
    if (!v.token || !v.reg) continue;
    if ((v.prefs || {}).soiree === false) continue;
    (tokensByReg[v.reg] = tokensByReg[v.reg] || new Set()).add(v.token);
  }
  const perReg = {};
  entries.forEach(e => (e.regs || []).forEach(reg => { (perReg[reg] = perReg[reg] || []).push(e.spec); }));
  let total = 0;
  for (const reg in perReg) {
    const toks = [...(tokensByReg[reg] || [])];
    const body = `N'oublie pas de donner le bilan sur WhatsApp 🎭 (${[...new Set(perReg[reg])].join(', ')})`;
    for (const tk of toks) {
      const r = await fcmSend(pid, token, tk, '💬 Bilan de soirée', body, APP_URL + '#soiree', 'soiree-' + today);
      if (r.ok) total++;
    }
  }
  await firestorePatch(pid, token, `sentLog/soiree-${today}`, { at: new Date().toISOString(), count: total, by: 'cf-cron' });
}

/* ── Vérifie un jeton d'identité Firebase → renvoie l'uid (ou null) ────────────
   Via Identity Toolkit accounts:lookup (clé API publique). Protège les routes
   exchangeCode / refreshToken : seul l'utilisateur authentifié agit sur son jeton. */
async function verifyFirebaseIdToken(idToken) {
  if (!idToken) return null;
  try {
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    if (!r.ok) return null;
    const d = await r.json();
    const u = d && d.users && d.users[0];
    return (u && u.localId) ? u.localId : null;
  } catch (e) { return null; }
}

/* ── Appel du endpoint de jetons Google (échange code / refresh) ──────────────── */
async function googleToken(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  return r.json();
}

/* ── Custom token Firebase (RS256, clé du compte de service) ───────────────────
   Ouvre une session Firebase Auth côté app via signInWithCustomToken. */
async function makeFirebaseCustomToken(sa, uid, claims) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 3600,
    uid: String(uid).slice(0, 128),
    claims: claims || {}
  };
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc(header) + '.' + enc(payload);
  const key = await importKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return unsigned + '.' + b64url(new Uint8Array(sig));
}

/* ── OAuth2 : JWT signé RS256 → access_token (scope cloud-platform) ─────────── */
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  };
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc(header) + '.' + enc(claim);
  const key = await importKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64url(new Uint8Array(sig));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('OAuth: ' + JSON.stringify(data));
  return data.access_token;
}

async function importKey(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
                 .replace(/-----END PRIVATE KEY-----/, '')
                 .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ── Firestore REST ────────────────────────────────────────────────────────── */
async function firestoreGet(pid, token, path) {
  const r = await fetch(`${FS}${pid}/databases/(default)/documents/${path}`,
    { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  return r.json();
}
async function firestoreList(pid, token, coll) {
  let docs = [], pageToken = '';
  do {
    const url = `${FS}${pid}/databases/(default)/documents/${coll}?pageSize=300`
              + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) break;
    const d = await r.json();
    docs = docs.concat(d.documents || []);
    pageToken = d.nextPageToken || '';
  } while (pageToken);
  return docs;
}
async function firestorePatch(pid, token, path, obj) {
  const mask = Object.keys(obj).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const r = await fetch(`${FS}${pid}/databases/(default)/documents/${path}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(obj) })
  });
  return r.ok;
}

/* ── FCM HTTP v1 ───────────────────────────────────────────────────────────── */
async function fcmSend(pid, token, deviceToken, title, body, link, tag) {
  // DATA-ONLY : title/body/url/tag dans `data` → le service worker affiche lui-même
  // la notif (onBackgroundMessage) → fiable app fermée, y compris en PWA iOS.
  const msg = {
    message: {
      token: deviceToken,
      data: { title: title || '', body: body || '', url: link || '', tag: tag || '3t' },
      webpush: { fcmOptions: { link } }
    }
  };
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${pid}/messages:send`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(msg)
  });
  // 404 / UNREGISTERED → jeton mort (à nettoyer éventuellement)
  return { ok: r.ok, gone: r.status === 404 || r.status === 400 };
}

/* ── Conversions valeurs typées Firestore ↔ JS ─────────────────────────────── */
function parseFields(fields) {
  const out = {};
  for (const k in (fields || {})) out[k] = parseVal(fields[k]);
  return out;
}
function parseVal(v) {
  if (v == null) return null;
  if ('stringValue'    in v) return v.stringValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue'      in v) return null;
  if ('mapValue'       in v) return parseFields(v.mapValue.fields || {});
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(parseVal);
  return null;
}
function toFields(obj) {
  const out = {};
  for (const k in obj) {
    const val = obj[k];
    if (typeof val === 'boolean') out[k] = { booleanValue: val };
    else if (typeof val === 'number') out[k] = Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    else out[k] = { stringValue: String(val) };
  }
  return out;
}

/* ── Helpers HTTP ──────────────────────────────────────────────────────────── */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function cors(resp, origin) {
  // Reflète l'origine si elle est autorisée, sinon valeur neutre.
  const allow = (origin && originAllowed(origin)) ? origin : ALLOWED_ORIGINS[0];
  resp.headers.set('Access-Control-Allow-Origin', allow);
  resp.headers.set('Vary', 'Origin');
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return resp;
}
