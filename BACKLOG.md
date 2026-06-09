# 📋 Backlog & doc technique — Calendrier 3T TECH

> Application web mono-fichier (`calendrier_3T.html`) pour gérer le planning des régies
> d'un théâtre (3T), les heures, les heures supplémentaires et l'intermittence.
> Déployée en PWA sur GitHub Pages.
> **Dernière mise à jour : 2026-06-09**

---

## 🏷️ Versions

- **V1** = tag git **`v1`** (état stable de référence). Pour y revenir : `git reset --hard v1`.
- **Version courante affichée** : constante `APP_VERSION` en haut du `<script>` (≈ ligne 2116),
  visible **en bas de ⚙️ Paramètres** ET **sur l'écran de connexion** (`#login-version`).
  Bumper à chaque évolution notable. Actuelle : **`b60`**.
- **Mise à jour auto** : l'app se recharge seule quand le nouveau service worker prend la main
  (`controllerchange` → `location.reload`). Plus de versions bloquées en cache après un déploiement.

## 🔔 Architecture des notifications (résumé)

- **Formations → INSTANTANÉ** via **Worker Cloudflare** (`https://formation-notif.nano66explosion.workers.dev/`,
  code `cloudflare/worker.js`, secret `FIREBASE_SERVICE_ACCOUNT`). L'app appelle `notifyFormationNow(id)` à la
  création (`FORMATION_WORKER_URL` en dur ~ligne 1882). Le Worker envoie le push en quelques secondes + `notified:true`.
- **Cron GitHub `*/15` = FILET DE SECOURS** (toutes les 15 min, best-effort). Gère le **STOP heures supp**, « régie
  demain », « bilan soirée », et **rattrape** une formation seulement si le Worker a échoué (`notified` encore `false`).
  ⚠️ Les crons rapprochés (`*/5`) sont **ignorés par GitHub** → ne jamais redescendre sous ~15 min.
- **Clic sur une notif** → les deux service workers (`sw.js` + `firebase-messaging-sw.js`) focus la fenêtre et
  naviguent vers `#f-<date>`/`#today`/`#soiree` (URL passée dans `data.url`).

## ☁️ Backend Firebase (push, planning partagé, formations)

- **Projet Firebase** : `tapp-2c0a8` (plan **gratuit Spark**). Config + clé VAPID **en dur** dans
  `calendrier_3T.html` (`FIREBASE_CONFIG`, `FCM_VAPID_KEY`) ET dans `firebase-messaging-sw.js` (même config).
- **Firestore — collections** : `pushTokens` (1 doc/appareil = `3t_device_id`, champs token/reg/prefs/platform),
  `schedule/v1` (planning à venir publié par l'app pour le cron), `formations` (date/heure/sujet/by/participants/notified),
  `sentLog` (anti-doublon envois), `stops` (STOP heures supp déjà notifiés),
  `profiles` (**1 doc par email Google** = `email/name/reg/emoji/anniv/updatedAt` → profil synchronisé multi-appareils).
- **Règles Firestore à publier** (sinon push/formations KO) :
  ```
  match /pushTokens/{t} { allow read, write: if true; }
  match /schedule/{d}   { allow read, write: if true; }
  match /formations/{d} { allow read, write: if true; }
  match /meetingSlots/{d} { allow read, write: if true; }
  match /notes/{d} { allow read, write: if true; }
  match /profiles/{e} { allow read, write: if true; }
  ```
- **Notif formation INSTANTANÉE (Cloudflare Worker)** : le cron GitHub `schedule` étant non fiable (runs `*/5`
  ignorés, retards jusqu'à 1h+), la notif de formation part désormais d'un **Worker Cloudflare gratuit**
  (`cloudflare/worker.js`, voir `cloudflare/README.md`). L'app `POST { id }` au Worker à la création
  (`notifyFormationNow` → `FORMATION_WORKER_URL`, constante ~ligne 1882, **à renseigner après déploiement**).
  Le Worker (secret `FIREBASE_SERVICE_ACCOUNT`) lit la formation + `pushTokens` via Firestore REST, signe un
  JWT RS256 → access_token, envoie FCM HTTP v1, met `notified:true`. **Le cron reste un filet de secours**
  (n'envoie que les formations `notified:false`). Tant que `FORMATION_WORKER_URL` est vide → tout passe par le cron.
- **GitHub Actions** (dans le repo, ajoutés via l'UI web car le token local n'a pas le scope `workflow`) :
  `.github/workflows/push-reminders.yml` (cron `*/15 * * * *` = toutes les 15 min → `scripts/send-reminders.js`) et
  `.github/workflows/broadcast.yml` (manuel → `scripts/broadcast.js`). **Secret** `FIREBASE_SERVICE_ACCOUNT`
  (clé compte de service Firebase, JSON complet). Le compte de service doit avoir **l'API Drive activée +
  le dossier heures supp partagé** (lecture) pour la détection STOP.
- **scripts/** : `send-reminders.js` (régie demain, bilan soirée ~22h, notif formations, STOP — respecte les
  `prefs` par jeton via `tokensFor`), `broadcast.js` (respecte pref `info`), `package.json` (firebase-admin, googleapis, xlsx).

## 🔐 Divers

- **Identité git** : RIZZO / nano66explosion@gmail.com. **Régisseur de l'app = Rizzo** (onglet « Théo Rizzo »).
- **Vérif syntaxe avant push** : extraire le dernier `<script>` → `osascript -l JavaScript` + `new Function(src)`.
- **iOS** : les notifications n'apparaissent que si l'app est **installée sur l'écran d'accueil** (iOS ≥ 16.4).
  Le « from 3T TECH » sous le titre est ajouté par iOS (non supprimable).

---

## 🌐 Déploiement & dépôt

- **Repo GitHub** : `nano66explosion/APP3T` — branche **`main`** (déploiement direct). *(Anciennement `3ttest`, renommé le 2026-06-06 ; les anciens liens redirigent.)*
- **Site** : `https://nano66explosion.github.io/APP3T/calendrier_3T.html`
- **Workflow** : les modifs sont **commit + push directement sur `main`** (push auto possible :
  identifiants enregistrés dans le trousseau macOS). Une branche `dev` existe mais inutilisée pour l'instant.
- **`.gitignore`** : exclut les `*.xlsx` (données réelles à ne pas publier), `.DS_Store`, `.claude/`.
- **Fichiers versionnés** : `calendrier_3T.html`, `manifest.webmanifest`, `sw.js`,
  `icon-192.png`, `icon-512.png`, `BACKLOG.md`, `.gitignore`.
- **Fichiers locaux NON versionnés** (dossier `APP 3T`, pour tests uniquement) :
  `copie plan tech.xlsx`, `Base HEURES SPECT2026 Modèle.xlsx`, `HEURES MAI 26.xlsx`,
  `HEURES JUIN 26.xlsx`, logo source PNG.

## 🗂️ Architecture du fichier `calendrier_3T.html`

- Un seul fichier : `<head>` (métas PWA + libs CDN), `<style>` (tout le CSS), `<body>`
  (écran connexion + écran app + modales), `<script>` (toute la logique).
- **Libs externes (CDN)** : `gapi`/`gsi` (Google), `xlsx` (SheetJS 0.18.5), `jszip` 3.10.1.
- **Logos** : intégrés en **base64** directement dans le HTML (écran connexion + en-tête).
- **Vérif syntaxe JS** utilisée pendant le dev : extraire le dernier `<script>` et
  `osascript -l JavaScript` avec `new Function(src)` (pas de Node dispo).

## 🔑 Configuration Google Drive (IDs en dur dans le JS)

```
DEFAULT_CLIENT_ID = 792962540106-...apps.googleusercontent.com
DEFAULT_PLAN_ID   = 1PVlsCn2SS3BmJaehNdjsh3xhjPhTCVh_   (plan tech)
DEFAULT_BASE_ID   = 1CjVuC4zHxfjxJE0YACQk3efqZDbbBT3a   (repli seulement)
HSUPP_FOLDER_ID   = 1-HR96E9cjorFO9j9navxlQ1MKEVg9_7v   (dossier heures supp + base)
```
- **Scopes OAuth** : `drive` (lecture+écriture tous fichiers) + `spreadsheets`. `SCOPE_VERSION='4'`
  (changer la version force le re-consentement). Jeton mis en cache (~1h) + reconnexion silencieuse.
- **Plan tech** & **base heures** : chargés **automatiquement** à la connexion (`ensureDefaultFiles`).
- **Base heures** : repérée **par NOM** dans le dossier Drive (fichier commençant par « Base HEURES »
  via `resolveBaseFile`), car l'ID peut changer ; repli sur `DEFAULT_BASE_ID`.
- **Heures supp** : fichier du **mois courant** trouvé dans le dossier par nom
  `HEURES <MOIS> <ANNÉE>` (`resolveHsuppForMonth`), ex. « HEURES JUIN 26 ».

---

## ✅ FAIT (stable)

### Connexion / PWA
- Connexion Google, jeton caché, reconnexion auto silencieuse, bouton déconnexion.
- **PWA installable** (`manifest.webmanifest` nom « 3T TECH », `sw.js`, icônes 192/512).
  Métas iOS (`apple-mobile-web-app-*`), `theme-color`, `apple-touch-icon`.
- **Notifications locales** (à l'ouverture) : rappel régie du jour / lendemain (bouton dans Paramètres).
  ⚠️ Pas de vrai push serveur (GitHub Pages statique).
- Bouton **🔄 Rafraîchir** : recharge plan + base depuis Drive.
- **Mise à jour auto** : l'app se recharge quand un nouveau service worker prend la main
  (`controllerchange` → `location.reload`). **Numéro de version** (`APP_VERSION`) affiché en bas des Paramètres.
- **Détection de l'année d'une feuille robuste** (`parsePlanTech`) : A2 (date), sinon 1ʳᵉ date trouvée,
  sinon année dans le nom de la feuille (« Sept 25 » → 2025) — évite qu'un mois entier soit ignoré.
- **Page d'aide 💡** (modale `help-modal`) : mode d'emploi complet avec **sommaire cliquable**
  (16 rubriques, scroll interne via `helpJump`/`helpTop`). Bouton 💡 dans l'en-tête ET sur l'écran de connexion.
  Rubrique 15 « En détail » : explique concrètement ce que l'app **lit et écrit** dans le plan tech et le fichier heures supp.
- **Barre de chargement à la connexion** (`login-steps`) : 4 étapes affichées en direct avec spinner →
  ✅ vert / ⚠️ (Connexion Google · Plan tech · Base heures · Fichier heures supp du mois) + barre de progression
  (`setStep`, `loginStepsShow`). Le fichier heures supp du mois est désormais repéré dès la connexion (`ensureDefaultFiles`).

### Écran de connexion / Paramètres
- Écran d'accueil sobre. **Fenêtre « Paramètres »** (modale) : sélection manuelle plan/base/heures supp,
  Client ID (avancé), profil régisseur, activation notifications.

### Lecture du plan tech
- Parse `.xlsx` ET Google Sheets natif (export). Colonnes en dur (`SLOTS_SAM`/`SLOTS_SEM`).
- Normalisation des régisseurs (`REGS` : Maxime, JM, Jules, Théo, Simon, Rizzo, Charly, Laurie, Louis).
- Salles : 3T (vert), 3T Côté (orange), Grand Théâtre (bleu), Tournée (violet), Observation (gris).

### Vues
- **Grille** (calendrier mensuel) : jour J **illuminé** (fond + contour vert, plus de rond blanc).
  Pastille couleur par salle + 🎤 sur les dates avec invité + ❌ sur les annulés (remplace la pastille).
- **Agenda** : cartes (mobile) / **tableau lisible** (PC en mode équipe).
- **Résumé** : accordéons (Spectacles du mois, Heures calculées, Tournées, Top régisseurs).
  ❌ Section « Intermittence » **retirée** du résumé (doublon avec la page dédiée).
- **Recherche** par **date** et par **spectacle/artiste** (regroupée Spectacles / Invités / Tournées).
- **Stats** (Régies / Heures spect. / Tournées) + carte **« régie du jour »**.
  Le détail des heures s'ouvre au survol/clic de la carte « Heures spect. ».

### Mode « Voir toute l'équipe »
- Impacte **uniquement** : grille, agenda, régie du jour. **PAS** les stats ni le résumé (toujours perso).
- Agenda PC : tableau dédié. Invités = ligne **fond rose** + badge ; annulés = ligne **barrée rouge**.

### Artistes invités (couleur orange)
- Détectés par la **couleur de police orange `#e97132`** (theme accent2) du nom dans le plan tech.
  `parseCellStyles` gère : police de cellule, **couleur de thème**, texte enrichi en ligne,
  **chaînes partagées** (sharedStrings) — cas réel le plus courant.
- Badge **🎤 invité (rose, `--cguest:#f472b6`)**, 🎤 sur le calendrier, listés par nom partout,
  **exclus du calcul d'heures**. Légende : « 🎤 Artiste invité » (texte normal).

### Spectacles annulés (texte barré)
- Détectés par le **style barré** (`<strike>`) de la cellule.
- Grille : **❌** à la place de la pastille. Agenda/détail : **ligne barrée + rouge** + badge ❌ annulé.
- **Exclus** du calcul d'heures et du comptage de régies.

### Calcul d'heures (base heures spectacles)
- Par représentation = montage(salle) + durée + démontage(salle) + 1h service (formules du fichier base).
- Détail par spectacle ; invités et annulés exclus ; « non trouvés dans la base » signalés à part.
- **Matching tolérant aux coquilles** (`matchBaseSpec` + distance d'édition OSA `_osa`/`_wordFuzzy`) :
  1 faute (≥4 lettres), 2 fautes sur mots longs (≥8). Ex. 3Crime→Crime, Vensie→Venise, Monlogues→Monologue.
- **Particularités** (`extractSpecial`) : privatisation / coop / semi privé / privé → retirées du nom
  (la pièce est calculée normalement) et affichées en **pastille** sur la date (calendrier + détail/agenda).
- **Base heures** : nom commençant par « Base HEURE » ; si plusieurs, prend le **non-Modèle le plus récent**.
- **Lecture récursive** du dossier heures supp **+ sous-dossiers** (ex. « heures 25-26 ») pour le cumul annuel.
- **Couverture du calcul** (Intermittence) : récap global ✅ calculables / ❌ non trouvés / 🎤 invités.

### Profil régisseur
- Profil local (régisseur + emoji avatar), modifiable (clic avatar = **récap**, édition dans Paramètres).
- **Récap régisseur** (clic avatar) : avatar + nom + saison, stats, liste spectacles (Théâtre/Invités/
  Tournées) avec barres, **+ total heures supp par mois** (lu dans le dossier Drive) + cumul.
- Le récap suit le **régisseur sélectionné** dans le menu déroulant.

### Page Intermittence
- Jauge vers **507h** = **heures spectacles + heures supp** (recalculée après lecture des fichiers).
- Totaux saison, **détail par mois** (total du mois + sous-ligne « régie Xh (n régies) · supp Yh »),
  reconstruit après lecture des heures supp (`monthRowsHTML`/`updateIntermiMonths`) — inclut les mois
  qui n'ont **que** des heures supp.
- **Couverture du calcul d'heures** (bloc dépliable, tout le théâtre) : ✅ calculables / ❌ non trouvés / 🎤 invités.
- **Total régies / tournées** + **« Total heures supp (année) »** (cumul tous les fichiers du dossier).

### Édition du planning (écriture Drive)
- **Se positionner / se retirer** d'une régie : écriture chirurgicale (Google Sheets via API,
  ou `.xlsx` via JSZip en préservant la mise en forme). Regex **paresseuses** (`[^>]*?`) pour ne pas
  avaler les cellules auto-fermantes voisines.
- Boutons présents dans **le détail de la grille, les cartes d'agenda ET le tableau équipe PC**
  (fonction commune `posActionHTML`, marche en perso ET en équipe).
- Pas de retrait sur un **mois passé**.

### Heures supplémentaires (gros module)
- Fichier mensuel `.xlsx`, **un onglet par régisseur** (mapping `heuresSheetForReg` : Rizzo→« Théo Rizzo »,
  Théo→« Théo S », etc.). Colonnes A=Date, B=Début, C=Fin, D=Motif, E=Nb Heures (formule MROUND 0.25).
- Bouton **⏱️ Heure supp** dans l'en-tête → modale : choix régisseur, **date** (picker natif),
  **Début/Fin en quart d'heure via 2 selects séparés (heure + minute)**, motif, durée calculée en direct.
- **Récap modifiable** : liste des heures déclarées, **édition / suppression** par ligne.
- **Réorganisation auto** (`rewriteHeuresSupp`) : tri chronologique (date puis heure) + **compactage**
  dès la ligne 3, **sans trous**, à chaque ajout/édition/suppression.
- **Ne touche JAMAIS** la ligne **TOTAL** (`=SUM(E3:E33)`, ~ligne 34) ni en dessous ; ignore STOP/TOTAL
  à la lecture ; résout les **dates implicites** (ligne sans date = jour de la ligne précédente).
- **Blocage** si le patron a posé un **STOP** dans l'onglet (« période clôturée »).
- **Total exact recalculé côté app** depuis Début/Fin (la valeur en cache de la formule peut être périmée),
  affiché en **décimal** (1h30 = `1.5h`). Total du mois = `<span>` non éditable.

### Responsive / mobile
- **Mobile** : page défile naturellement (on atteint le bas). **En-tête collé** en haut +
  **bloc contrôles** (équipe/légende/onglets) collé **juste dessous** (offset = hauteur en-tête,
  calculé en JS via `updateStickyOffsets`). Respect **safe-area** (Dynamic Island).
- **Paysage téléphone** : la mise en page PC 2 colonnes n'apparaît plus (médias `min-width:768px`
  **et `min-height:500px`**) → reste en colonne mobile lisible.
- **PC** : carte centrée 2 colonnes (gauche = logo→régie du jour ; droite = équipe→calendrier),
  points + emoji agrandis, logo en-tête 64px.

---

### Mode hors-ligne (#19)
- Cache localStorage `3t_offline_cache` (planning parsé + base). Lecture seule sans réseau,
  bannière + écritures bloquées. `sw.js` v2 pré-cache l'app + libs CDN.
- La page **Couverture du calcul d'heures** (Intermittence) est **conservée** (suivi base).

### Bilan soirée (WhatsApp) & Formations
- **Bilan soirée** : bouton sous la régie du jour (après 21h) + menu Plus → messages courts
  (`soireeMessages`, sans emoji) selon les spectacles du jour → ouvre WhatsApp (`wa.me`). Push ~22h (`remindSoiree`, lien `#soiree`).
- **Choix des notifications** (Paramètres) : cases par type (régie/stop/soirée/info/formation),
  stockées en localStorage + doc Firestore du jeton (`prefs`) ; le cron filtre via `tokensFor`.
- **Formations** : collection Firestore `formations` (date, heure, sujet, by, participants).
  Création (modale, menu Plus + détail d'un jour), positionnement (`toggleFormation`), suppression par le créateur.
  **Le créateur propose mais ne se positionne pas** (participants vides à la création, libellé « Vous avez proposé
  cette formation », garde-fou dans `toggleFormation`). Affichage : marqueur 📚 calendrier + cartes dans
  détail/régie du jour/semaine **+ filtre 📚 Formations dans l'agenda** (#7). Le bouton **🔄 Rafraîchir recharge
  aussi les formations** (`loadFormations` dans `refreshData`). Cron `notifyFormations` prévient les autres
  (lien `#f-<date>`) — **ne marque `notified:true` que si au moins 1 push est parti** (sinon réessai au run suivant),
  cron toutes les 5 min. **Règle Firestore `formations` requise.**
  **Clic sur la notif → bonne date** : `firebase-messaging-sw.js` a un gestionnaire `notificationclick` (enregistré
  AVANT `firebase.messaging()` + `stopImmediatePropagation` pour passer devant le défaut Firebase) qui **focus la
  fenêtre déjà ouverte et la navigue** (sinon le clic remettait juste l'app au 1er plan sans changer le hash).
  L'URL cible est passée dans `data.url` du message (`send-reminders.js`) ; le SW `postMessage({type:'notif-nav',hash})`
  à la page, qui écoute (`navigator.serviceWorker` message) → `location.hash` + `handleNotifNav` → `gotoDate` (grille +
  jour sélectionné + détail avec « Je participe »).

### Réunion planning (Framadate)
- Sondage partagé pour caler la **réunion mensuelle** des régisseurs. Collection Firestore **`meetingSlots`**
  (1 doc/créneau : `date`, `time` au quart d'heure, `by`, `available[]`). **Règle Firestore `meetingSlots` requise.**
- N'importe quel régisseur **propose un créneau** (date + heure), chacun **coche sa dispo** (`toggleMeetingAvail`,
  arrayUnion/Remove), le créneau le plus large s'affiche en **vert ★ top**. Suppression d'un créneau par son auteur.
- Entrées : bouton **🗓️ Réunion** dans l'en-tête PC + menu **⋯ Plus** (mobile). Modale `meeting-modal`,
  fonctions `openMeeting`/`loadMeetingSlots`/`submitMeetingSlot`/`renderMeetingSlots`. Les créneaux **passés sont
  masqués** (auto-nettoyage d'un mois sur l'autre). **Pas de push** (consultation in-app, décision 2026-06-08).

### Accueil : prochaine régie + rappel heures supp
- **Prochaine régie** (`nextRegie`/`nextRegieHTML`) : quand pas de régie aujourd'hui, la carte « Régie du jour »
  affiche « ⏭️ Prochaine régie dans X jours · date · spectacle (salle) » (jour strictement après aujourd'hui où
  je suis positionné, hors observateur/annulé/tournée).
- **Rappel heures supp fin de mois** (`hsuppReminderHTML`/`dismissHsuppReminder`) : bandeau ambre sur l'accueil
  les 3 derniers jours du mois (bouton « Déclarer » → `openHsupp`, ✕ masque pour le mois, clé `3t_hsupp_rem_<mois>`).
  + **notif locale** 1×/mois à l'ouverture (`checkReminders`, clé `3t_hsupp_notif_<mois>`).

### Notes partagées
- Section **📝 Notes** (en-tête PC + menu Plus mobile) : chaque régisseur écrit une note, **tout le monde la voit**.
  Collection Firestore **`notes`** (`text`, `by`, `createdAt`). **Règle Firestore `notes` requise.** Modale `notes-modal`,
  fonctions `openNotes`/`loadNotes`/`submitNote`/`deleteNote`/`renderNotes`. Suppression par l'auteur. Tri plus récent en haut.

### Résumé → Heures calculées : bloc « 💼 comptés en heures supp »
- Affiche `heures.hsupp` (Blind Test, Faux British…) avec la mention « heures supp » au lieu d'une valeur.
  **Limite** : Faux British est saisi dans les colonnes « Matin/Après-midi » (non lues) → n'apparaît que s'il est
  dans les colonnes 18h45/21h. Blind Test (colonnes lues) remonte bien.

### Onglet Calendrier unifié (Semaine / Mois / Année)
- Les vues **Semaine** et **Mois** sont fusionnées dans **un seul onglet « 📅 Calendrier »** (bottom-nav mobile +
  onglets PC). Un **sélecteur d'échelle** (`#cal-scale-switch`, segmented control iOS) bascule **Semaine / Mois / Année**.
- **Vue Année** (`renderYear`) : mini-mois de la saison (`allMois`), jours avec régie en vert, aujourd'hui entouré ;
  clic sur un mini-mois → `gotoMonth` → zoom sur la vue Mois.
- **Animations** façon Calendrier Apple (`animateView`, classes `cal-anim-in`/`cal-anim-out`, keyframes `calZoomIn/Out`) :
  zoom-in vers une échelle plus fine, dézoom vers une plus large. `currentView` ∈ {week, grid, year, list, resume} ;
  `CAL_SCALES`/`SCALE_ORDER`/`calLastScale` ; `openCal()` rouvre la dernière échelle.

### Refonte disposition + gestes (état b56, 2026-06-08)
- **Structure « pages »** : `#app-screen > #pages > [#page-home, #page-hsupp] + bottom-nav`. Chaque page glisse en
  entier (mobile). **PC préservé** : `#pages`/`#page-home`/`#page-hsupp` en `display:contents` (≥768px) → la mise en
  page 2 colonnes (`app-col-left`/`app-col-right`) reste intacte. Visibilité des pages via la classe `body.page-hsupp`.
- **Bottom-nav 3 boutons** (icônes **SVG** sobres, `stroke:currentColor` → clair/sombre) : **Heures** (horloge, gauche) ·
  **Home** (calendrier, centre) · **Plus** (grille, droite). `bnav-hsupp`/`bnav-home`/`bnav-more`, `updateBottomNav`.
- **Page Home** = calendrier (`HOME_VIEWS=['week','grid','year','list']`) : Semaine/Mois/Année au **sélecteur**
  (`#cal-scale-switch`) **+ agenda** via bouton `#btn-agenda-toggle` (Mois ↔ Liste, `toggleAgenda`, visible en Mois/Liste).
- **Page Heures** = `#view-hsupp` dans `#page-hsupp` (plus une modale ; `openHsupp()`=`switchView('hsupp')`).
  `.hsupp-page` a une marge **safe-area** en haut (Dynamic Island).
- **Carrousel unifié** (`initCalCarousel`, geste sur `#app-screen`) : séquence `SEQ=['hsupp','week','grid','year']`,
  `seqIdx()` (list≈grid). Deux animations : **scale** (Semaine/Mois/Année → seule la VUE glisse, voisine pré-rendue via
  `renderInto`+`_calPreview`) et **page** (Home↔Heures → la PAGE entière glisse, `#page-home`/`#page-hsupp`). Verrou
  `animating` + capture locale des éléments (`settle`) = plus de blocage au milieu. `SCALE_ORDER` = sens des switch au tap.
- **Pull-to-refresh** (`initPullToRefresh`, sur `document`, haut de page seulement, désactivé si un volet ouvert) :
  overscroll natif (la page descend) + **pastille flottante** en haut avec **l'icône flèche refresh** ; la flèche **tourne
  avec le pull** puis **spin continu dès le seuil atteint** (classe `.spinning` = `@keyframes ptrSpin`). Même icône que le
  **bouton 🔄** de l'en-tête (`#btn-refresh`/`#btn-refresh-m`, classe `.refresh-btn`, qui tourne pendant `refreshData`).
- **Volet « Plus »** : ouverture **animée** (slide-up + fondu, `openMoreMenu`) + fermeture au **swipe vers le bas** ou clic
  ailleurs (animé, `closeMoreMenu`). **Bouton Paramètres retiré** de l'en-tête mobile (dispo dans Plus).
- **Haptique** : `hapticTick()` = Vibration API (Android). **iOS web ne supporte pas les vibrations** (astuce `<input switch>`
  testée et abandonnée) → no-op sur iPhone.
- **Divers** : version affichée sur l'écran de connexion ; barres de scroll masquées ; double-tap zoom désactivé.

### b57 (2026-06-09) — Nav du mois repositionnée
- La **barre de navigation du mois** (`#month-nav` : ‹ · `mois-select` · › · « Auj. ») était dans l'en-tête
  (`.app-header`, colonne gauche). Déplacée **dans `#view-container`, juste avant `#view-grid`** (sous le sélecteur
  d'échelle), donc **directement au-dessus de la zone de recherche** en vue Mois. Toujours **partagée** par Mois /
  Agenda / Résumé (masquée Semaine / Année via `mnav-hidden`, logique inchangée dans `switchView`). Padding inline
  `.15rem 1rem .35rem` pour aligner avec la `search-row`.

### b58 (2026-06-09) — Sélecteur d'échelle conservé en vue Liste
- En vue **Liste** (agenda), le sélecteur `#cal-scale-switch` (Semaine/Mois/Année) disparaissait (Liste ∉ `CAL_SCALES`).
  Désormais il **reste visible** en vue Liste (`switchView` : `display` si `CAL_SCALES.includes(v) || v==='list'`), avec
  le bouton **« Mois » en surbrillance** (la Liste = l'échelle Mois en version agenda, `activeScale='grid'`). Permet de
  rebasculer vers Semaine/Année directement depuis l'agenda.

### b60 (2026-06-09) — Compte par email Google : profil synchronisé + intermittence sur année anniversaire
- **Identité par email** : à la connexion, `fetchGoogleIdentity()` lit l'email via l'API Drive `about?fields=user`
  (scope `drive` déjà accordé → **aucun re-consentement**, pas de bump `SCOPE_VERSION`). Stocké dans `googleEmail`
  + `localStorage 3t_google_email` (minuscules).
- **Profil partagé** (collection Firestore **`profiles`**, clé = email) : `loadProfileForEmail(email)` (appelé dans
  `onAuthenticated`, avant le chargement des fichiers) écrit `3t_my_reg`/`3t_my_emoji`/`3t_anniv` en localStorage →
  **le même compte retrouve son régisseur/avatar/anniversaire sur n'importe quel appareil**. `saveProfileToCloud()`
  (appelé dans `saveProfile`) propage le profil au cloud (`set merge`). **Règle Firestore `profiles` requise.**
- **Onboarding** : la modale `#profile-modal` (déclenchée par `launchApp` quand `!getMyReg()`, donc à la 1ʳᵉ connexion
  d'un email inconnu) gagne un champ **date anniversaire d'intermittence** (`#profile-anniv`, optionnel). `getMyAnniv()`
  = `3t_anniv`.
- **Intermittence calée sur l'anniversaire** (au lieu de la saison du plan tech) : si une date anniversaire est
  renseignée, la jauge 507h se calcule sur **12 mois glissants à partir de la dernière date anniversaire passée**,
  **au jour près**. `annivWindow(anniv)` → `{start, end}` (start = dernier anniversaire ≤ aujourd'hui, end = +1 an exclu).
  `computeWindow(reg, start, end)` (calqué sur `computeSeason`, réutilise `buildDayMap`+`computeHeures`, filtre les jours
  hors fenêtre). Heures supp fenêtrées : `loadRecapHsuppRange`/`sumHsuppHoursRange`/`hsRowDate` (mois pleins → somme
  entière, mois de bordure → au jour près, parse la date colonne A). **Repli sur `computeSeason`/`loadRecapHsupp`
  (toute la saison)** si pas d'anniversaire → aucune régression. En-tête de la modale : « Année intermittence
  JJ/MM/AAAA → JJ/MM/AAAA » au lieu de « Saison … ».

### b59 (2026-06-09) — Animation au changement de mois
- En **vue Mois**, changer de mois (flèches `‹ ›`, menu déroulant, bouton « Auj. ») fait **glisser la grille**
  `#cal-grid` : entrée depuis la droite vers le mois suivant, depuis la gauche vers le précédent
  (`animateMonthGrid(dir)`, classes `.mgrid-fwd`/`.mgrid-back`, keyframes `mgridInRight`/`mgridInLeft`, ~280 ms).
  Le sens est connu directement pour les flèches/Auj., et calculé pour le menu déroulant via `_prevMonthKey`
  (mémorisé en haut de `renderCalendar`). `changeMonth` ne fait plus rien si on est déjà au 1er/dernier mois.
  Animation **uniquement en vue Mois** (no-op ailleurs).

## 🚧 À surveiller / limites connues

- **Détection couleur/barré** dépend du format exact du `.xlsx` (validée sur les fichiers actuels).
  Si la mise en forme change côté Drive, re-vérifier `parseCellStyles`.
- **Heures supp** : limité à ~**30 lignes/onglet** (plage de la formule E3:E32 du modèle).
- **Reconnexion** : jeton Google ~1h (flux implicite, pas de refresh token), renouvellement silencieux GIS.
  *Idée discutée (2026-06-08, NON faite)* : session persistante via **flux authorization-code** + **refresh token stocké
  dans Cloudflare Worker/KV**. Gratuit. Version « test Google » = 7 jours sans vérification ; « infinie » = vérification Google
  (scope Drive sensible). Risque sécurité = endpoint à protéger (pas de vraie auth utilisateur). À faire si les déconnexions iOS gênent.
- **Notifications push** : **formations = INSTANTANÉ** via le Worker Cloudflare (cf. section Backend). Le reste
  (STOP heures supp, « régie demain », « bilan soirée », rattrapage formations) passe par le **cron GitHub Actions
  `*/15`** (best-effort, parfois 15-40 min ; ne jamais redescendre sous ~15 min, GitHub ignore les crons rapprochés).
  Pas de Cloud Functions (Spark gratuit). iOS : app installée sur l'écran d'accueil requise.
- **Fichiers Drive** doivent être des **.xlsx** pour l'écriture (heures supp, plan tech xlsx).
- **Colonnes du plan tech en dur** : un changement de structure du fichier casserait le parsing.

## 💡 Améliorations proposées — LISTE NUMÉROTÉE (référence stable)

> L'utilisateur peut demander une amélioration **par son numéro** (ex. « fais 7 et 9 »).
> Garder cette numérotation stable. Cocher [x] quand c'est fait.

- [x] **1. Sélecteur de mois pour les heures supp** — consulter/déclarer un autre mois que le mois courant. *(NB : initialement listé, mais voir #1 dans "Faits récents" — encore à confirmer ; si non fait, à implémenter : menu mois dans la modale heure supp.)*
- [x] **2. Barre de chargement** globale en haut (showBusy) sur les écritures/refresh. ✅ FAIT
- [x] **3. Toasts de confirmation** ✅/❌ après positionnement / heures supp / refresh. ✅ FAIT
- [x] **4. Bouton « Aujourd'hui »** (« Auj. ») dans la nav du mois → revient au mois courant. ✅ FAIT
- [x] **5. Élargir la colonne en paysage** téléphone (760px). ✅ FAIT
- [x] **6. Recherche accessible partout** — bouton loupe 🔍 dans l'en-tête (`openSearch`) : bascule sur la Grille et place le focus dans le champ de recherche spectacle, depuis n'importe quelle vue. ✅ FAIT
- [x] **7. Filtres dans l'agenda** — puces (`agenda-filters`) : Toutes / Mes régies / Non attribuées / par salle (3T, 3T Côté, GT, Tournée) **+ 📚 Formations**. Marche en agenda perso, équipe mobile ET tableau équipe PC. **Filtre Formations** (`agendaFilter==='formation'`) : affiche uniquement les jours avec formation (cartes `formationCardsHTML`), bypasse le tableau équipe PC ; les formations apparaissent aussi dans « Toutes ». ✅ FAIT
- [x] **8. Pastilles colorées pour les rôles** — point couleur par rôle (titulaire vert / doublon bleu / observateur anneau gris / formateur ambre) au lieu des tags texte `(obs.)`/`(form.)`. Helper `roleDot()`, légende mise à jour. ✅ FAIT
- [x] **9. Thème clair** — variables CSS claires (`:root[data-theme="light"]`), bouton bascule **dès la page de connexion** ET dans ⚙️ Paramètres, mémorisé en localStorage (`3t_theme`), `theme-color` synchronisé. Boutons inversés corrigés (`color:var(--bg)` au lieu de `#0f0f0f`). ✅ FAIT
- [ ] **10. Accessibilité** — meilleurs contrastes des gris, taille de police ajustable.
- [~] **11. Vue patron** — ~~heures supp de toute l'équipe + clôture STOP~~. **ABANDONNÉ** (décision utilisateur, 2026-06-06).
- [ ] **12. Export PDF / impression** d'un récap mensuel (régies + heures supp + progression 507h).
- [x] **13. Détection des conflits** — `computeConflicts(y,m)` repère un régisseur sur **2 salles à la même heure** le même jour (toute l'équipe, annulés/observateurs/tournées exclus). Marqueur **💥** sur le calendrier + bandeau rouge **cliquable** sous les stats → modale `conflict-modal` (jour, régisseur, heure, salles+spectacles en conflit), clic → ouvre le jour. ✅ FAIT
- [x] **14. Alerte régies non attribuées** — bandeau « ⚠️ X régies sans personne ce mois » sous les stats (compté en vue équipe, annulés exclus). **+** marqueur **⚠️** sur chaque jour concerné dans le calendrier, **+** bandeau **cliquable** → modale `unassigned-modal` listant date / salle / spectacle, clic sur une ligne → ouvre le jour dans la grille (`showUnassigned`/`gotoUnassigned`). ✅ FAIT
- [ ] **15. Statistiques avancées** — heures par salle/type, comparaison mois par mois, projection 507h.
- [x] **16. Vrai push (Firebase)** — ✅ FAIT (app fermée). Projet Firebase `tapp-2c0a8` (FCM + Firestore, plan gratuit). Client : SDK compat, `firebase-messaging-sw.js` (scope dédié), enregistrement des jetons dans Firestore (`pushTokens`), `publishSchedule()` publie le planning à venir (`schedule/v1`). Envoi via **GitHub Actions cron** (`scripts/send-reminders.js`, workflow `push-reminders.yml`) = « 🎭 Régie demain ». **Broadcast manuel** à toute l'équipe (`scripts/broadcast.js`, workflow `broadcast.yml`). Secret `FIREBASE_SERVICE_ACCOUNT`. iOS : nécessite l'app installée sur l'écran d'accueil (le « from 3T TECH » est ajouté par iOS, non supprimable). **Déclencheur clôture STOP** (`checkStops` dans `send-reminders.js`) : lit les fichiers heures supp sur Drive via le compte de service (lecture seule), notifie « 🔒 Heures supp clôturées », anti-doublon (collection `stops`). Setup : API Drive activée + dossier partagé avec l'email du compte de service. **Bouton activer/désactiver** dans Paramètres (`3t_push_disabled`). **Anti-doublon** : 1 doc par appareil (`3t_device_id`), dédoublonnage des jetons à l'envoi, `tag` sur les notifs, `skipWaiting` sur le SW. **Clic notif régie → `#today`** (accueil + régie du jour). Cron `0 6-21/2 * * *` (« régie demain » envoyé seulement 17h-22h Paris ; STOP à chaque run). **Broadcast manuel** : `scripts/broadcast.js` + workflow `broadcast.yml`.
- [x] **17. Détection auto des colonnes du plan tech** (par en-têtes) — ✅ FAIT. `detectPlanColumns(rows)` lit les
  3 lignes d'en-tête (salles « 3T / 3T CÔTE / GRAND THEATRE », horaires 18h45/21h, « Spectacle/Régie/Tournée »),
  reconstruit `slotsSam`/`slotsSem`/`tourCol`. **Repli sur les colonnes EN DUR** (`SLOTS_SAM/SEM`) si l'analyse
  échoue → ne casse jamais. Vérifié : produit exactement le mapping en dur sur le fichier actuel.
- [x] **18. Message clair quand la limite ~30 heures supp/mois est atteinte.** ✅ FAIT
- [x] **19. Mode hors-ligne** — ✅ FAIT. Le planning parsé (plan + base + barrés/invités) est mis en cache localStorage (`3t_offline_cache`) à chaque chargement/refresh (`saveOfflineCache`). Au démarrage **sans réseau** (ou si le chargement Drive échoue), l'app s'ouvre **en lecture seule** depuis le cache (`loadOfflineCache`/`enterOfflineMode`) avec une **bannière** « 📴 Mode hors-ligne ». Écritures bloquées (`blockIfOffline` sur positionnement, heures supp, refresh). Bascule online/offline en direct. `sw.js` **v2** pré-cache aussi les libs CDN + cache réseau-d'abord. `gapi.load` protégé (libs CDN possiblement absentes hors-ligne).
- [ ] **20. Découper le fichier** — externaliser JS/CSS/images (le HTML fait ~1 Mo, logos base64) → chargement + maintenance + coût de lecture améliorés.
- [x] **21. Refonte interface page principale** — ✅ FAIT (1ʳᵉ version). Mobile : **barre d'onglets en bas**
  (`bottom-nav` : 📆 Semaine · 📅 Mois · 📋 Agenda · ⏱️ Heures · ⋯ Plus) + **menu « Plus »** bottom-sheet
  (`more-modal` : Résumé, Intermittence, Bilan soirée, Formation, Recherche, Aide, Paramètres, Déconnexion).
  En-tête mobile allégé avec **régisseur visible** (chip avatar+nom, clic = récap) + 🔄 + ⚙️. **Vue « Ma semaine »
  par défaut** (`renderWeek`). PC inchangé. `updateBottomNav`/`openMoreMenu`.
- [x] **22. Bilan de soirée → WhatsApp** — ✅ FAIT. Bouton sous la régie du jour (après 21h) + menu Plus →
  modale avec **sélecteur de spectacle** (celui du jour préselectionné) + **5 messages** (`soireeMessages`,
  sans emoji) → ouvre `wa.me` pré-rempli. Push de rappel ~22h (`remindSoiree`, lien `#soiree`).
- [x] **23. Choix des notifications** — ✅ FAIT. Cases par type dans Paramètres (régie/stop/soirée/info/formation),
  `localStorage 3t_notif_prefs` + champ `prefs` du doc Firestore ; le cron filtre (`tokensFor`).
- [x] **24. Formations** — ✅ FAIT (voir section Firebase). Proposer/positionner/supprimer, affichage calendrier
  (📚) + détail/régie du jour/semaine, notif aux autres via cron. Horaire au quart d'heure. Champs `.fm-input`.

---

## 🔧 EN COURS / à finir (calibrage heures intermittence)

> Mis de côté à la demande de l'utilisateur — à reprendre. Objectif : que les heures de la page
> Intermittence collent à la **fiche de paye** de **Rizzo** (intermittent, payé à l'heure).
> Constats : Sept app 39.5h vs paye 35 ; Oct 66.25 vs 72. Total par mois = heures spectacle (formule
> base : montage+durée+démontage+1h service par représentation) + heures supp déclarées.
> Causes identifiées : (a) **« Blind Test 80's » absent de la base** → 0h en octobre (~5h manquantes) ;
> (b) « Aéro » = vraie pièce (« Aero Malgré Lui ») — corrigé via `applyGuestBaseOverride` (orange + dans la
> base = comptée) ; (c) reste à **vérifier la lecture des heures supp** mois par mois.
> **À faire côté données** : compléter la base heures (Blind Test, Faux British, Vacances Rêve…) ;
> côté app : confirmer les valeurs réelles montage/durée/démontage si la formule diffère de la paye.
> **2026-06-08 — CORRECTIF MAJEUR** : l'app ne lisait QUE le créneau 21h en semaine → elle **ratait les
> séances 18h45 en semaine** (fréquentes pendant les fêtes). Désormais `SLOTS_SEM` (et `detectPlanColumns`)
> lisent **les deux créneaux** en semaine (18h45 + 20h), cases vides ignorées. Ex. déc. : +2 régies pour Rizzo
> (Meilleur Homme 26/12, Crime 29/12). Devrait beaucoup réduire l'écart de décembre. **Décisions du 2026-06-08** :
> préfixes « 33/37 » = ignorés (codes internes) ; parenthèses `X(Y)` → Y = observateur (exclu) ; tournées sans
> régisseur = ignorées (à compléter dans le fichier : déc 11/12 « SEMI PRIVE BOUYGUES », mars 13-14-28/03 « Monde Merveilleux »).
> **Spectacles « comptés en heures supp »** (`HSUPP_SPEC_NAMES = ['blind test','faux british']`, `isHsuppSpec`) :
> ce sont de vraies régies mais leurs heures sont déclarées en heures supp (pas dans la base). `computeHeures`/
> `computeCoverage` les sortent des « ❌ non trouvés » → catégorie à part **« 💼 comptés en heures supp »**
> (Intermittence → Couverture, et détail « Heures spect. »). **NE PAS les ajouter à la base** (double comptage).
> **2026-06-08 — Réveillon (3 créneaux)** : le 31/12 est saisi sur **3 lignes** (date seulement sur la 1ʳᵉ),
> créneaux **18h45 / 21h / 23h** (l'heure dans la colonne 18h45, le spectacle+régie dans la colonne 21h).
> `parsePlanTech` gère les **lignes de continuation** (ligne sans date mais avec contenu spectacle → rattachée à
> la date précédente ; cellules d'heure seules ignorées). Vérifié : seul le réveillon utilise ce format.
> ⚠️ Le **2ᵉ bloc de colonnes T-Z** (« Matin/Après-midi » = Faux British/heures supp, répétitions, montages,
> auditions, SOCOTEC…) reste **NON lu** volontairement (fourre-tout, pas des paires Spectacle/Régie).

## 🧭 Pour reprendre après un /clear

1. Code sur GitHub `main` (à jour, version **b56**). Fichier principal : `calendrier_3T.html` (~1 Mo, mono-fichier).
   Autres : `sw.js`, `firebase-messaging-sw.js`, `scripts/*.js`, `.github/workflows/*.yml`, **`cloudflare/worker.js`**
   (notif formation instantanée, déployé sur `https://formation-notif.nano66explosion.workers.dev/`).
2. **Lire ce BACKLOG en entier** (architecture, Firebase, Cloudflare, refonte UI b56, versions, limites) avant de coder.
3. Modifs ciblées (grep/offset), **ne pas relire tout le fichier d'un coup** (~1 Mo, logos base64).
4. **Avant push** : vérifier la syntaxe JS — extraire le dernier `<script>` (regex `<script(?![^>]*src=)...>(.*?)</script>`,
   prendre le dernier bloc) → `osascript -l JavaScript` + `new Function(src)`. Vérifier aussi `sw.js`/`worker.js` si touchés.
5. **Bumper `APP_VERSION`** (≈ ligne 2116) à chaque évolution notable (visible dans Paramètres + écran connexion).
6. Pousser : `cd "APP 3T" && git add -A && git commit -m "…" && git push origin main` (finir le message par
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`). ⚠️ Token local **sans scope `workflow`** → ne pas
   modifier `.github/workflows/*` par push (l'utilisateur le fait via l'UI web). ⚠️ Si l'utilisateur a édité un fichier
   côté web GitHub (ex. un workflow), faire `git pull --rebase origin main` **avant** de pousser.
7. **Tenir ce backlog à jour** à chaque évolution.
8. **Règles Firestore requises** (sinon écriture KO) : `pushTokens`, `schedule`, `formations`, `meetingSlots`, `notes`,
   **`profiles`** (toutes `allow read, write: if true`). À publier dans la console Firebase si une nouvelle collection est ajoutée.
9. **Restant à faire** : #10 (accessibilité / taille police), #12 (export PDF), #15 (stats avancées / projection 507h),
   #20 (découper le fichier), + **calibrage heures intermittence** (compléter la base ; comparer app vs paye).
   Pistes confort : finaliser Réunion (créneau retenu, notif), notifs Notes, session persistante Cloudflare (cf. limites).
10. **Dernier sujet en cours (avant le /clear)** : on venait de finir une grosse **refonte UI/navigation** (pages Home/Heures
   qui glissent en entier, carrousel unifié Heures·Semaine·Mois·Année, pull-to-refresh icône flèche, bottom-nav SVG).
   Tout est poussé et fonctionnel côté code/syntaxe, mais **non testé visuellement** → l'utilisateur doit valider sur
   iPhone (swipe, pages, pull-to-refresh) et sur PC (mise en page 2 colonnes préservée via `display:contents`).
