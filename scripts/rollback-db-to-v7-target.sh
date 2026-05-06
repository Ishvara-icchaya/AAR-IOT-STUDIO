#!/usr/bin/env bash
# v8 failure rollback (no schema migration required for your plan):
#   1) Clear operational data (devices, objects, dashboards, etc.) while keeping
#      customers, sites, users, platform config — see services/api/scripts/clear_operational_data.py
#   2) Redeploy the v7 application (git tag / container image); this script does not change app code.
#
# Optional second path — schema downgrade — only if you explicitly need Alembic reversions
# (requires ROLLBACK_METADATA_REVISION, etc.).
#
# Usage:
#   ./scripts/rollback-db-to-v7-target.sh [operational|schema] [local|docker]
#
# Shorthand (operational + mode):
#   ./scripts/rollback-db-to-v7-target.sh docker
#
# Operational (default): clears all tenants when CLEAR_ALL_CUSTOMERS=1 is exported by this script.
#
#   ./scripts/rollback-db-to-v7-target.sh operational local
#   ./scripts/rollback-db-to-v7-target.sh docker
#
# Schema (Alembic downgrade — rare if v8 added no migrations you must reverse):
#   export ROLLBACK_METADATA_REVISION=0030
#   optional: export ROLLBACK_TIMESCALE_REVISION=ts0002
#   ./scripts/rollback-db-to-v7-target.sh schema docker
#
# Env:
#   SKIP_ROLLBACK_CONFIRM=1  — non-interactive (e.g. CI); dangerous on production.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="${REPO_ROOT}/services/api"

KIND="operational"
MODE="local"
if [[ "${1:-}" == "local" || "${1:-}" == "docker" ]]; then
  MODE="$1"
elif [[ "${1:-}" == "operational" || "${1:-}" == "schema" ]]; then
  KIND="$1"
  if [[ "${2:-}" == "local" || "${2:-}" == "docker" ]]; then
    MODE="$2"
  fi
fi

METADATA_REV="${ROLLBACK_METADATA_REVISION:-}"
TIMESCALE_REV="${ROLLBACK_TIMESCALE_REVISION:-}"

confirm() {
  if [[ "${SKIP_ROLLBACK_CONFIRM:-}" == "1" ]]; then
    return 0
  fi
  echo "Rollback kind: ${KIND}  |  Run mode: ${MODE}"
  if [[ "$KIND" == "operational" ]]; then
    echo "This will CLEAR_ALL_CUSTOMERS operational data (all tenants), keeping sites/users/customers."
  else
    echo "This will run Alembic downgrade on METADATA to revision: ${METADATA_REV}"
    if [[ -n "$TIMESCALE_REV" ]]; then
      echo "Timescale Alembic will downgrade to: ${TIMESCALE_REV}"
    else
      echo "Timescale Alembic: skipped."
    fi
  fi
  read -r -p "Type YES to continue: " confirm
  if [[ "$confirm" != "YES" ]]; then
    echo "Aborted."
    exit 1
  fi
}

clear_operational_local() {
  (cd "$API_DIR" && CLEAR_ALL_CUSTOMERS=1 python scripts/clear_operational_data.py)
}

clear_operational_docker() {
  docker compose -f "${REPO_ROOT}/docker-compose.yml" exec -T \
    -e CLEAR_ALL_CUSTOMERS=1 \
    api python scripts/clear_operational_data.py
}

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

case "$KIND" in
  operational)
    confirm
    case "$MODE" in
      local) clear_operational_local ;;
      docker) clear_operational_docker ;;
      *) echo "usage: unknown mode (use local or docker)" >&2; exit 1 ;;
    esac
    echo "Operational clear finished. Next: redeploy the v7 application build (image or git tag)."
    ;;
  schema)
    if [[ -z "$METADATA_REV" ]]; then
      echo "error: schema rollback requires ROLLBACK_METADATA_REVISION (e.g. export ROLLBACK_METADATA_REVISION=0030)." >&2
      exit 1
    fi
    confirm
    case "$MODE" in
      local)
        rollback_metadata_local
        rollback_timescale_local
        ;;
      docker)
        rollback_metadata_docker
        rollback_timescale_docker
        ;;
      *) echo "usage: unknown mode (use local or docker)" >&2; exit 1 ;;
    esac
    echo "Alembic downgrade finished. Verify: alembic current (and alembic_timescale.ini current). Then redeploy v7 app if needed."
    ;;
  *)
    echo "usage: $0 [operational|schema] [local|docker]   — or: $0 [local|docker] for operational" >&2
    exit 1
    ;;
esac
