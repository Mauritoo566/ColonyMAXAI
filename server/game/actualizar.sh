#!/usr/bin/env bash
# Actualiza el juego a la última versión de GitHub y reinicia el servidor.
# Uso (en el servidor): /opt/colonymaxai/app/server/game/actualizar.sh
set -euo pipefail
cd /opt/colonymaxai/app
git pull --ff-only
npm ci --omit=dev --no-audit --no-fund
sudo systemctl restart colonymaxai-game
sleep 2
systemctl --no-pager --lines=5 status colonymaxai-game
