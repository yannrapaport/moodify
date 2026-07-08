#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}==>${NC} $1"; }
warn()  { echo -e "${YELLOW}  ! $1${NC}"; }
error() { echo -e "${RED}  ✗ $1${NC}"; exit 1; }

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

# Require Debian/Ubuntu
if ! command -v apt-get &>/dev/null; then
  error "This script requires a Debian/Ubuntu system."
fi

info "Installing Moodify on VPS..."

# Docker
if ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  warn "Added $USER to docker group — you may need to log out/in for it to take effect."
else
  info "Docker already installed: $(docker --version)"
fi

# Caddy
if ! command -v caddy &>/dev/null; then
  info "Installing Caddy..."
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update
  sudo apt-get install -y caddy
else
  info "Caddy already installed: $(caddy version)"
fi

# .env
if [ ! -f .env ]; then
  cp .env.example .env
  warn ".env créé depuis .env.example — remplis les valeurs avant de continuer :"
  warn "  nano $REPO_DIR/.env"
  echo ""
  read -rp "Appuie sur Entrée une fois le .env prêt..."
else
  info ".env déjà présent, on continue."
fi

# Detect domain from .env
DOMAIN=$(grep -oP '(?<=SPOTIFY_REDIRECT_URI=https://)([^/]+)' .env | head -1 || true)
if [ -z "$DOMAIN" ]; then
  warn "Impossible de détecter le domaine depuis SPOTIFY_REDIRECT_URI."
  read -rp "Entre ton domaine (ex: moodify.example.com) : " DOMAIN
fi

info "Configuration Caddy pour : $DOMAIN"
sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
$DOMAIN {
    reverse_proxy localhost:3000
}
EOF

sudo systemctl enable caddy
sudo systemctl reload caddy 2>/dev/null || sudo systemctl start caddy

# Build & start
info "Build et démarrage de Moodify..."
docker compose build
docker compose up -d

info "Moodify est en ligne !"
echo ""
echo "  App     : https://$DOMAIN"
echo "  Health  : https://$DOMAIN/health"
echo "  Spotify : https://$DOMAIN/auth/login"
echo ""
echo "Ouvre l'URL Spotify ci-dessus dans ton navigateur pour authentifier."
