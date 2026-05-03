#!/usr/bin/env bash
# Rebuild frontend (npm) and Docker images for the default stack (docker-compose.yml).
# Invoked by ./run.sh up|all (main path only). May also be run directly or from go.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -f "${ROOT}/env.sh" ]]; then
  # shellcheck disable=SC1091
  source "${ROOT}/env.sh"
fi

if [[ "${SKIP_FRONTEND_BUILD:-0}" == "1" ]]; then
  echo "[build.sh] SKIP_FRONTEND_BUILD=1 — skipping npm run build"
else
  echo "[build.sh] npm run build..."
  npm run build
fi

echo "[build.sh] docker compose build (docker-compose.yml)..."
docker compose -f docker-compose.yml build
