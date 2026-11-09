# Duel des dles

Petite app auto-hébergée pour comparer chaque jour vos scores de jeux quotidiens (Wordle, Globle, Angle, Minecraftle, Poople, Krillion… et 15 autres du catalogue) entre potes, sans limite de joueurs.

- **Joueurs gérés dans l'app** : chacun s'ajoute au premier passage (« Qui es-tu ? »), pas de mot de passe. Renommer, archiver, supprimer dans *Réglages*.
- **Code d'accès commun facultatif** (`ACCESS_CODE`), demandé une fois par appareil.
- **Saisie en un geste** : on colle les textes de partage, les scores se remplissent tout seuls.
- **PWA installable** : sur Android, *Partager → Duel des dles* depuis le jeu et c'est enregistré.
- **Raccourci iPhone** via un jeton personnel (`/api/text`).
- **Temps réel** : la page se met à jour quand l'autre poste.
- **Notifications** ntfy, Discord ou Slack quand quelqu'un poste ses scores.
- Stats (7 j / 30 j / tout), cumul des victoires, records, séries, historique, export CSV/JSON.
- **Zéro dépendance** : Node ≥ 22.13 (SQLite intégré à Node), une seule image, un seul volume.

## Démarrage

Avec l'image construite automatiquement par GitHub Actions (amd64 et arm64) :

```bash
cp .env.example .env      # ACCESS_CODE, NOTIFY_URL, PUBLIC_URL…
docker compose pull && docker compose up -d
```

Ou en construisant l'image toi-même : `docker compose up -d --build`.

> Le dépôt étant privé, l'image GHCR l'est aussi : fais `docker login ghcr.io` (jeton GitHub avec `read:packages`) sur le serveur, ou rends le paquet public dans GitHub → Packages.

L'app répond sur `http://<ton-serveur>:3000`. Les données sont dans `./data` (base `duel.db` et le secret de session).

## Configuration (`.env`)

| Variable | Rôle |
|---|---|
| `ACCESS_CODE` | Code commun demandé une fois par appareil. Vide = accès libre (déconseillé si exposé sur Internet). |
| `TZ` | Fuseau utilisé pour « aujourd'hui » côté serveur (partage Android, raccourci iOS). |
| `PUBLIC_URL` | URL publique, ajoutée aux notifications. |
| `NOTIFY_URL` | ntfy (`https://ntfy.sh/mon-topic`), webhook Discord ou Slack. Vide = pas de notification. |
| `NOTIFY_DELAY_SECONDS` | Délai avant envoi, pour regrouper les corrections (90 s par défaut). |
| `COOKIE_SECURE` | `true` si servi en HTTPS sans en-tête `X-Forwarded-Proto`. |
| `SECRET` | Facultatif : secret de signature (sinon généré dans `data/secret`). |
| `PLAYERS` | Ancienne config `id:Nom,…` : crée ces joueurs au démarrage si la base n'en a aucun. |

## Derrière un reverse proxy (recommandé)

L'installation en PWA et le partage Android **exigent HTTPS**. Exemple Caddy :

```
duel.mondomaine.fr {
    reverse_proxy duel-dles:3000
}
```

Avec Nginx, désactive le buffering pour le temps réel (SSE) sur `/api/events` (`proxy_buffering off;`). L'app envoie déjà `X-Accel-Buffering: no`. Si tout passe par le proxy, retire la section `ports` du compose et mets le conteneur sur le réseau du proxy.

## Saisie depuis le téléphone

**Android** : ouvre l'app en HTTPS, menu → *Installer l'application*. À la fin d'un jeu, *Partager → Duel des dles* : le score est enregistré à ton nom (le joueur choisi sur cet appareil) pour aujourd'hui.

**iPhone** (Safari ne gère pas le partage vers une web app) : dans l'app **Raccourcis**, crée :

1. *Obtenir le presse-papiers*
2. *Obtenir le contenu de l'URL* → `https://duel.mondomaine.fr/api/text`, méthode **POST**, en-tête `Authorization: Bearer <jeton>` (visible dans *Réglages* de l'app), corps **Fichier** = Presse-papiers
3. *Afficher la notification* avec le contenu obtenu

Après un jeu : « Copier », puis lancer le raccourci (ou l'épingler sur l'écran d'accueil).

API équivalente en ligne de commande :

```bash
curl -X POST -H "Authorization: Bearer <jeton>" --data-binary "Wordle 1 602 4/6" https://duel.mondomaine.fr/api/text
```

## Reprendre l'historique de la démo Claude

Dans la démo : *Historique → Sauvegarde JSON*. Ici : *Réglages → Importer une sauvegarde…*. Les joueurs Val et Pips sont créés automatiquement et la liste des jeux est reprise.

## Sauvegarde et mise à jour

- Sauvegarde : copie le dossier `./data` (ou *Réglages → Télécharger la sauvegarde JSON*).
- Mise à jour : `git push` sur `main` reconstruit l'image, puis sur le serveur `docker compose pull && docker compose up -d`.

## Développement sans Docker

```bash
node --watch server.js
```

## Structure

```
server.js            API + fichiers statiques + SSE + notifications (node:http, node:sqlite)
public/games.js      catalogue, lecture des partages, règles de comparaison (partagé front/serveur)
public/app.js        interface
public/index.html    page
public/sw.js         service worker (installation PWA)
```

Pour ajouter un jeu au catalogue, ajoute une entrée dans `PRESETS` (`public/games.js`) avec sa fonction `parse(text)`. Sinon, utilise « Ajouter un jeu perso » dans l'interface.
