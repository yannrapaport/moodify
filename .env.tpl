# Template des variables d'environnement moodify.
# Copier en `.env` et remplir les valeurs (secrets via Bitwarden, PAS de 1Password).
# docker-compose lit `.env` (env_file).
SPOTIFY_CLIENT_ID=<spotify-client-id>
SPOTIFY_REDIRECT_URI=https://moodify.theproductguy.cloud/auth/callback
MCP_API_KEY=<mcp-api-key>
PORT=3000
DB_PATH=/data/moodify.db
ALLOWED_ORIGIN=https://moodify.theproductguy.cloud
