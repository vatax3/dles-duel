#!/bin/sh
# Le dossier ./data monté depuis l'hôte appartient souvent à root : on le donne
# à l'utilisateur node puis on lance le serveur sans privilèges.
set -e
chown -R node:node /data 2>/dev/null || true
exec su-exec node "$@"
