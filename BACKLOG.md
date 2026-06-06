# 📋 Backlog & doc technique — Calendrier 3T TECH

> Application web mono-fichier (`calendrier_3T.html`) pour gérer le planning des régies
> d'un théâtre (3T), les heures, les heures supplémentaires et l'intermittence.
> Déployée en PWA sur GitHub Pages.
> **Dernière mise à jour : 2026-06-06**

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

### Profil régisseur
- Profil local (régisseur + emoji avatar), modifiable (clic avatar = **récap**, édition dans Paramètres).
- **Récap régisseur** (clic avatar) : avatar + nom + saison, stats, liste spectacles (Théâtre/Invités/
  Tournées) avec barres, **+ total heures supp par mois** (lu dans le dossier Drive) + cumul.
- Le récap suit le **régisseur sélectionné** dans le menu déroulant.

### Page Intermittence
- Jauge vers **507h**, totaux saison, détail par mois, par spectacle.
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

## 🚧 À surveiller / limites connues

- **Détection couleur/barré** dépend du format exact du `.xlsx` (validée sur les fichiers actuels).
  Si la mise en forme change côté Drive, re-vérifier `parseCellStyles`.
- **Heures supp** : limité à ~**30 lignes/onglet** (plage de la formule E3:E32 du modèle).
- **Reconnexion** : jeton Google ~1h (limite sans backend). Pas de « connexion infinie ».
- **Notifications** : locales seulement (pas de push serveur).
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
- [x] **7. Filtres dans l'agenda** — puces (`agenda-filters`) : Toutes / Mes régies / Non attribuées / par salle (3T, 3T Côté, GT, Tournée). Marche en agenda perso, équipe mobile ET tableau équipe PC. ✅ FAIT
- [x] **8. Pastilles colorées pour les rôles** — point couleur par rôle (titulaire vert / doublon bleu / observateur anneau gris / formateur ambre) au lieu des tags texte `(obs.)`/`(form.)`. Helper `roleDot()`, légende mise à jour. ✅ FAIT
- [x] **9. Thème clair** — variables CSS claires (`:root[data-theme="light"]`), bouton bascule **dès la page de connexion** ET dans ⚙️ Paramètres, mémorisé en localStorage (`3t_theme`), `theme-color` synchronisé. Boutons inversés corrigés (`color:var(--bg)` au lieu de `#0f0f0f`). ✅ FAIT
- [ ] **10. Accessibilité** — meilleurs contrastes des gris, taille de police ajustable.
- [~] **11. Vue patron** — ~~heures supp de toute l'équipe + clôture STOP~~. **ABANDONNÉ** (décision utilisateur, 2026-06-06).
- [ ] **12. Export PDF / impression** d'un récap mensuel (régies + heures supp + progression 507h).
- [x] **13. Détection des conflits** — `computeConflicts(y,m)` repère un régisseur sur **2 salles à la même heure** le même jour (toute l'équipe, annulés/observateurs/tournées exclus). Marqueur **💥** sur le calendrier + bandeau rouge **cliquable** sous les stats → modale `conflict-modal` (jour, régisseur, heure, salles+spectacles en conflit), clic → ouvre le jour. ✅ FAIT
- [x] **14. Alerte régies non attribuées** — bandeau « ⚠️ X régies sans personne ce mois » sous les stats (compté en vue équipe, annulés exclus). **+** marqueur **⚠️** sur chaque jour concerné dans le calendrier, **+** bandeau **cliquable** → modale `unassigned-modal` listant date / salle / spectacle, clic sur une ligne → ouvre le jour dans la grille (`showUnassigned`/`gotoUnassigned`). ✅ FAIT
- [ ] **15. Statistiques avancées** — heures par salle/type, comparaison mois par mois, projection 507h.
- [ ] **16. Vrai push (Firebase)** — notifications app fermée (veille de régie, positionné/retiré, régie vide). Nécessite un backend Firebase Cloud Messaging.
- [ ] **17. Détection auto des colonnes du plan tech** (par en-têtes) au lieu des colonnes en dur.
- [x] **18. Message clair quand la limite ~30 heures supp/mois est atteinte.** ✅ FAIT
- [ ] **19. Mode hors-ligne** — cache des données du mois (consultation sans réseau ; écriture toujours en ligne).
- [ ] **20. Découper le fichier** — externaliser JS/CSS/images (le HTML fait ~1 Mo, logos base64) → chargement + maintenance + coût de lecture améliorés.

---

## 🧭 Pour reprendre après un /clear

1. Le code est sur GitHub `main` (à jour). Travailler sur `calendrier_3T.html`.
2. Pousser : `cd "APP 3T" && git add -A && git commit -m "…" && git push origin main`.
3. Vérifier la syntaxe JS avant push (extraire `<script>` → `new Function`).
4. Ce backlog = état de référence. Le mettre à jour à chaque évolution notable.
