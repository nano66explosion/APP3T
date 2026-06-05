# 📋 Backlog — Calendrier 3T TECH

> Suivi du projet. Mis à jour au fil des modifications.
> Dernière mise à jour : 2026-06-05

---

## ✅ Fait (stable)

### Cœur calendrier
- Lecture du **plan tech** depuis Google Drive (Google Sheets natif **ou** .xlsx).
- Vues **Grille / Agenda / Résumé** + recherche par **date** et par **spectacle/artiste**.
- Stats du mois (régies, heures, tournées) + carte « régie du jour ».
- Mode **« Voir toute l'équipe »** (tableau lisible sur PC, cartes sur mobile).
- Marqueur du **jour J** : case illuminée (plus de rond blanc).

### Heures spectacles
- Lecture du **fichier base heures** depuis Drive.
- Calcul des heures par spectacle (montage + durée + démontage + service), exclus : tournées, annulés, invités, observateur.
- Détail des heures au survol/clic de la carte « Heures spect. ».

### Artistes invités & annulés
- **Artiste invité** détecté par la **couleur orange** du texte dans le plan tech (RGB, thème, texte enrichi, chaînes partagées). Badge 🎤 rose + 🎤 sur le calendrier, exclus du calcul d'heures.
- **Spectacle annulé** détecté par le **texte barré**. Grille : ❌ ; Agenda : ligne barrée rouge ; exclu des calculs.

### Profil & intermittence
- **Profil régisseur** local (régisseur + emoji), modifiable.
- Clic sur l'avatar → **récap du régisseur** (tous ses spectacles de la saison).
- Page **Intermittence** : récap annuel + jauge vers 507 h.

### Édition du planning (écriture Drive)
- Se **positionner / se retirer** d'une régie non attribuée (Google Sheets ET .xlsx, écriture chirurgicale qui préserve la mise en forme).
- Blocage du retrait sur les **mois passés**.

### Heures supplémentaires
- Sélection du **fichier heures supp** (.xlsx, un onglet par régisseur).
- Formulaire **Déclarer une heure supp** (date, début, fin, motif ; durée auto 0,25 h).
- **Récap modifiable** : liste des heures déclarées, **édition / suppression**.
- **Réorganisation auto** : tri chronologique + compactage (plus de trous) à chaque ajout/édition/suppression.
- **Blocage si STOP** posé par le patron (période clôturée).
- Saisie des heures par **quart d'heure** (step 15 min).
- Total du mois **en lecture seule**.

### PWA / technique
- **PWA installable** (manifest, service worker, icônes) — nom « 3T TECH ».
- Reconnexion Google **silencieuse** + cache du jeton.
- Safe-area iPhone (Dynamic Island).
- Bouton **🔄 Rafraîchir** (recharge plan + base depuis Drive).

---

## 🚧 En cours / à stabiliser

- **Détection couleur/barré .xlsx** : robuste sur les fichiers testés, mais dépend du format exact (à re-vérifier si la mise en forme change côté Drive).
- **Heures supp** : limité à ~30 lignes/onglet (plage de la formule du modèle). Ré-écriture validée sur fichier vierge ; à confirmer en usage réel sur Drive.
- **Reconnexion auto longue durée** : le jeton Google dure ~1 h (limite Google sans serveur). Cache + silencieux = pas de reclic tant que la session Google est active, mais pas « infini ».

## ⏳ À faire / à vérifier en réel

- **Chargement auto plan + base** (IDs Drive en dur) : implémenté → à valider sur ton compte.
- **Heures supp auto par mois** depuis le dossier Drive (`HEURES <MOIS> <ANNÉE>`) : implémenté → à valider (les fichiers du dossier doivent être des `.xlsx`).
- **Déploiement GitHub** : dépôt relié, push direct sur `main` opérationnel.

---

## 💡 Idées futures (proposées)

- **Sélection du mois** pour les heures supp (auto selon le dossier Drive).
- **Notifications push réelles** (nécessite un petit backend : Firebase) — rappels veille de régie, régie non attribuée, etc.
- **Export PDF/print** d'un récap mensuel (régies + heures supp + intermittence).
- **Mode hors-ligne** plus complet (cache des données du mois).
- **Récap d'équipe** : heures supp de tous les régisseurs côte à côte (vue patron).
- **Thème clair** optionnel.
- **Historique des modifications** (qui s'est positionné/retiré, quand).
