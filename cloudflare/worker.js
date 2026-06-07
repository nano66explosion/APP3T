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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (request.method !== 'POST')   return cors(json({ error: 'POST only' }, 405));

    let body;
    try { body = await request.json(); } catch (e) { return cors(json({ error: 'bad json' }, 400)); }
    const id = body && body.id;
    if (!id) return cors(json({ error: 'missing id' }, 400));

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
  }
};

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
  const msg = {
    message: {
      token: deviceToken,
      data: { url: link },
      webpush: {
        notification: { title, body, icon: 'icon-192.png', badge: 'icon-192.png', tag: tag || '3t' },
        fcmOptions: { link }
      }
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
function cors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return resp;
}
