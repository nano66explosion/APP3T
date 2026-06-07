# Worker Cloudflare — notif instantanée de formation

Push de formation **en quelques secondes**, **gratuit**, **sans Blaze**, la clé d'envoi
restant un secret côté serveur (jamais dans l'app).

## Déploiement (≈ 10 min, tout via le site Cloudflare, sans rien installer)

1. **Crée un compte gratuit** sur https://dash.cloudflare.com (aucune carte bancaire).
2. Menu de gauche → **Workers & Pages** → **Create application** → **Create Worker**.
3. Donne un nom (ex. `formation-notif`) → **Deploy** (peu importe le code par défaut).
4. **Edit code** : efface tout, **colle le contenu de `worker.js`**, puis **Deploy**.
5. Reviens sur le Worker → **Settings** → **Variables and Secrets** → **Add** :
   - Type **Secret**, nom **`FIREBASE_SERVICE_ACCOUNT`**,
   - valeur = **le JSON complet** du compte de service Firebase
     (le même que le secret GitHub `FIREBASE_SERVICE_ACCOUNT`).
   - **Save / Deploy**.
6. Note l'URL du Worker, du type `https://formation-notif.<ton-sous-domaine>.workers.dev`.
7. **Donne-moi cette URL** : je la mets dans l'app (constante `FORMATION_WORKER_URL`) et je pousse.

## Test rapide (facultatif, en ligne de commande)

```bash
curl -X POST https://<ton-worker>.workers.dev/ \
  -H 'Content-Type: application/json' \
  -d '{"id":"<idDuneFormationFirestore>"}'
```
Réponse attendue : `{"ok":true,"sent":N,"recipients":M}`.

## Comment ça marche

- L'app, à la création d'une formation (`submitFormation`), fait un `POST { id }` au Worker.
- Le Worker lit la formation + les jetons (`pushTokens`) dans Firestore, exclut le créateur,
  respecte la préférence `formation`, envoie le push FCM v1, puis met `notified:true`.
- **Le cron GitHub reste un filet de secours** : il n'enverra que si le Worker a échoué
  (il ne traite que les formations encore `notified:false`).

## Sécurité

- La clé Firebase est un **secret du Worker**, jamais dans le code public de l'app.
- L'URL du Worker est publique mais le Worker **ne notifie que pour une formation réelle
  non encore notifiée** → l'abus se limite à re-déclencher une notif légitime en attente.
