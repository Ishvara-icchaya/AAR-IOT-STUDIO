#!/bin/sh
set -e
cd /app

export ALEMBIC_DATABASE_URL="$(echo "${DATABASE_URL}" | sed 's/+psycopg2//')"
export ALEMBIC_TIMESCALE_URL="$(echo "${TIMESCALE_DATABASE_URL}" | sed 's/+psycopg2//')"

case "${AAR_DEBUG:-}" in 1|true|TRUE|yes|Yes)
  echo "[entrypoint] AAR_DEBUG: running alembic (metadata + timescale); DB URLs not logged"
  ;;
esac

echo "[entrypoint] Alembic: Postgres metadata"
alembic upgrade head

echo "[entrypoint] Alembic: TimescaleDB hypertables"
alembic -c alembic_timescale.ini upgrade head

echo "[entrypoint] Starting $@"
exec "$@"
