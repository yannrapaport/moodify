#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
NC='\033[0m'

info() { echo -e "${GREEN}==>${NC} $1"; }

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

info "Récupération du code..."
git pull

info "Rebuild de l'image Docker..."
docker compose build

info "Redémarrage du service..."
docker compose up -d

info "Moodify est à jour."
docker compose ps
