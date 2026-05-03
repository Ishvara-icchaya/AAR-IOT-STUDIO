#!/usr/bin/env bash
# Rebuild frontend (npm) and Docker images.
# Usage:
#   ./build.sh           — npm run build + docker compose (docker-compose.yml)
#   ./build.sh debug     — same npm rules + compose with docker-compose.debug.yml (for ./run.sh debug)
# Invoked by ./run.sh up|all and ./run.sh debug; go.sh uses ./build.sh then ./run.sh all.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -f "${ROOT}/env.sh" ]]; then
  # shellcheck disable=SC1091
  source "${ROOT}/env.sh"
fi

BUILD_KIND="${1:-}"

if [[ "${SKIP_FRONTEND_BUILD:-0}" == "1" ]]; then
  echo "[build.sh] SKIP_FRONTEND_BUILD=1 — skipping npm run build"
else
  echo "[build.sh] npm run build..."
  npm run build
fi

if [[ "${BUILD_KIND}" == "debug" ]]; then
  echo "[build.sh] docker compose build (docker-compose.yml + docker-compose.debug.yml)..."
  docker compose -f docker-compose.yml -f docker-compose.debug.yml build
else
  echo "[build.sh] docker compose build (docker-compose.yml)..."
  docker compose -f docker-compose.yml build
fi
