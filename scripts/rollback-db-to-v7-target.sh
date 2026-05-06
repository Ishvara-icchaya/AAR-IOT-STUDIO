#!/usr/bin/env bash
# Downgrade Postgres (metadata) and optionally Timescale Alembic chains to a
# revision you recorded when the deployed app matched v7.
#
# This runs Alembic *downgrade* (reverses migrations). It is not a substitute
# for a full DB restore from backup if v8 introduced incompatible data or you
# need point-in-time recovery.
#
# Prerequisites:
#   - Know the exact revision IDs at your last v7-compatible deploy (see
#     services/api/alembic/versions/*.py revision = "00xx" and
#     services/api/alembic_ts/versions/*.py revision = "ts00xx").
#   - Example from internal notes: metadata head was once 0030; your org may differ.
#
# Required env:
#   ROLLBACK_METADATA_REVISION   e.g. 0030  (Alembic revision to downgrade TO)
#
# Optional env:
#   ROLLBACK_TIMESCALE_REVISION  e.g. ts0002  (omit to skip Timescale Alembic)
#   SKIP_ROLLBACK_CONFIRM=1      skip interactive confirmation
#
# Modes (first argument):
#   local   — run alembic from services/api on the host (default)
#   docker  — run via: docker compose exec api … (from repo root)
#
# Examples:
#   export ROLLBACK_METADATA_REVISION=0030
#   ./scripts/rollback-db-to-v7-target.sh local
#
#   export ROLLBACK_METADATA_REVISION=0030 ROLLBACK_TIMESCALE_REVISION=ts0002
#   ./scripts/rollback-db-to-v7-target.sh docker

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="${REPO_ROOT}/services/api"
MODE="${1:-local}"

METADATA_REV="${ROLLBACK_METADATA_REVISION:-}"
TIMESCALE_REV="${ROLLBACK_TIMESCALE_REVISION:-}"

if [[ -z "$METADATA_REV" ]]; then
  echo "error: set ROLLBACK_METADATA_REVISION to the metadata Alembic revision id to downgrade TO (e.g. 0030)." >&2
  exit 1
fi

if [[ "${SKIP_ROLLBACK_CONFIRM:-}" != "1" ]]; then
  echo "This will run Alembic downgrade on the METADATA database to revision: ${METADATA_REV}"
  if [[ -n "$TIMESCALE_REV" ]]; then
    echo "Timescale Alembic will downgrade to: ${TIMESCALE_REV}"
  else
    echo "Timescale Alembic: skipped (ROLLBACK_TIMESCALE_REVISION unset)."
  fi
  echo "Mode: ${MODE}"
  read -r -p "Type YES to continue: " confirm
  if [[ "$confirm" != "YES" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

rollback_metadata_local() {
  (cd "$API_DIR" && alembic -c alembic.ini downgrade "$METADATA_REV")
}

rollback_timescale_local() {
  [[ -z "$TIMESCALE_REV" ]] && return 0
  (cd "$API_DIR" && alembic -c alembic_timescale.ini downgrade "$TIMESCALE_REV")
}

rollback_metadata_docker() {
  docker compose -f "${REPO_ROOT}/docker-compose.yml" exec -T api \
    sh -c "cd /app && alembic -c alembic.ini downgrade \"$METADATA_REV\""
}

rollback_timescale_docker() {
  [[ -z "$TIMESCALE_REV" ]] && return 0
  docker compose -f "${REPO_ROOT}/docker-compose.yml" exec -T api \
    sh -c "cd /app && alembic -c alembic_timescale.ini downgrade \"$TIMESCALE_REV\""
}

case "$MODE" in
  local)
    rollback_metadata_local
    rollback_timescale_local
    ;;
  docker)
    rollback_metadata_docker
    rollback_timescale_docker
    ;;
  *)
    echo "usage: $0 [local|docker]" >&2
    exit 1
    ;;
esac

echo "Done. Verify with: alembic current (and Timescale: alembic -c alembic_timescale.ini current) inside services/api or the api container."
