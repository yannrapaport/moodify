# Moodify

Serveur MCP Spotify avec un moteur de recommandation personnel, utilisable depuis Claude et par le plugin Moodify Remote (lunettes Even Realities G2).

## Mise en prod

- **Mode** : merge + deploy
- **Branche** : main (merge direct)
- **Tests** : `npm test` (vitest)
- **Déploiement** : `docker compose up -d --build`, depuis `PROD_DIR`
- **Machine** : nexus
- **Vérif** : `curl -sf https://moodify.theproductguy.cloud/health`
- **Confirmation** : non pour le cosmétique (UI, textes, style, docs, refacto) ; oui si le diff change un comportement (règle perso).
- `railway.toml` n'est pas la prod : la prod est ce compose sur Nexus (`.env` à la racine, hors git).
- Serveur MCP public, utilisé aussi par le plugin G2 (`/health`, CORS) : ne pas casser ces routes.
