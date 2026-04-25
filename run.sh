#!/usr/bin/env bash
# AAR-IoT-Studio — orchestration: shutdown, compile, Docker build, start stack.
# Usage:
#   ./run.sh debug [all]   — full stack, DEBUG + structured logs (see docker-compose.debug.yml)
#   ./run.sh debug api     — infra + api + frontend only
#   ./run.sh debug workers — infra + api + all workers + scheduler (no frontend)
#   ./run.sh debug ai      — infra + api + frontend + worker-ai + scheduler
#   ./run.sh debug ingest  — infra + api + worker-rest-poller + worker-ingest + worker-scrubber
#   ./run.sh up | all      — same: full default stack (compose up -d), INFO logging; optional profiles via COMPOSE_PROFILES
#   ./run.sh rest-poller   — rebuild + start worker-rest-poller; follow logs (outbound HTTP polling for Manage Devices REST)
#   ./run.sh down          — stop compose and free published host ports (see free_stack_host_ports)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -f "${ROOT}/env.sh" ]]; then
  # shellcheck disable=SC1091
  source "${ROOT}/env.sh"
fi

COMPOSE_BASE=(docker compose -f docker-compose.yml)
COMPOSE_DEBUG=(docker compose -f docker-compose.yml -f docker-compose.debug.yml)

# Mosquitto *host* publish port from .env if present (same key as docker-compose); else 18883 (compose default).
mqtt_broker_publish_port() {
  local v="18883"
  if [[ -f "${ROOT}/.env" ]]; then
    local line
    line="$(grep -E '^[[:space:]]*MQTT_BROKER_PUBLISH_PORT=' "${ROOT}/.env" 2>/dev/null | tail -1 || true)"
    if [[ -n "${line}" ]]; then
      v="${line#*=}"
      v="${v//\"/}"
      v="${v//\'/}"
      v="${v// /}"
    fi
  fi
  echo "${MQTT_BROKER_PUBLISH_PORT:-${v}}"
}

# Kill any process still listening on a TCP port (stray dev servers / stuck listeners after compose down).
kill_listeners_on_tcp_port() {
  local port="$1"
  [[ -n "${port}" ]] || return 0
  [[ "${port}" =~ ^[0-9]+$ ]] || return 0
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  fi
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti ":${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${pids:-}" ]]; then
      kill -TERM ${pids} 2>/dev/null || true
      sleep 0.35
      pids="$(lsof -ti ":${port}" -sTCP:LISTEN 2>/dev/null || true)"
      if [[ -n "${pids:-}" ]]; then
        kill -KILL ${pids} 2>/dev/null || true
      fi
    fi
  fi
}

# Host ports mapped in docker-compose.yml (defaults). Extra: RUN_SH_KILL_PORTS="5683 11434" (space-separated).
free_stack_host_ports() {
  local mqtt
  mqtt="$(mqtt_broker_publish_port)"
  local -a ports=(
    5173 8000
    9092
    9000 9001
    5433 5434
    16379
    "${mqtt}"
  )
  if [[ -n "${RUN_SH_KILL_PORTS:-}" ]]; then
    read -r -a extra <<< "${RUN_SH_KILL_PORTS}"
    ports+=("${extra[@]}")
  fi
  echo "[run.sh] Freeing host listeners on stack ports (if any): ${ports[*]}"
  local p deduped
  deduped="$(printf '%s\n' "${ports[@]}" | sort -nu)"
  while IFS= read -r p; do
    [[ -n "${p}" ]] && kill_listeners_on_tcp_port "${p}"
  done <<< "${deduped}"
}

export_aar_debug_env() {
  export AAR_DEBUG=true
  export AAR_LOG_LEVEL=debug
  export AAR_TRACE_PIPELINE=true
  export AAR_LOG_JSON=true
  export LOG_LEVEL=DEBUG
}

shutdown_all() {
  echo "[run.sh] Stopping Docker Compose stacks..."
  "${COMPOSE_DEBUG[@]}" down --remove-orphans 2>/dev/null || true
  "${COMPOSE_BASE[@]}" down --remove-orphans 2>/dev/null || true
  sleep 0.5
  free_stack_host_ports
  echo "[run.sh] Shutdown complete."
}

compile_frontend() {
  echo "[run.sh] Compiling frontend (npm ci + tsc + vite build)..."
  (cd "${ROOT}/services/frontend" && npm ci && npm run build)
}

cmd_debug() {
  local mode="${1:-all}"
  shutdown_all

  case "$mode" in
    workers|ingest)
      echo "[run.sh] Skipping frontend production build (mode: $mode)."
      ;;
    *)
      compile_frontend
      ;;
  esac

  export_aar_debug_env
  echo "[run.sh] Debug env: AAR_DEBUG AAR_LOG_LEVEL=debug AAR_TRACE_PIPELINE AAR_LOG_JSON LOG_LEVEL=DEBUG"
  echo "[run.sh] docker compose build (debug profile)..."
  "${COMPOSE_DEBUG[@]}" build

  echo "[run.sh] docker compose up — logs attached; Ctrl+C stops containers."
  echo "[run.sh] Tip: in another terminal, tail MQTT bridge with the same compose files (no --profile needed):"
  echo "       docker compose -f docker-compose.yml -f docker-compose.debug.yml logs -f worker-mqtt-bridge"
  echo "[run.sh] Tip: outbound REST polling (device_endpoints rest_mode=polling):"
  echo "       docker compose -f docker-compose.yml -f docker-compose.debug.yml logs -f worker-rest-poller"
  case "$mode" in
    all)
      echo "[run.sh] Starting worker-rest-poller (outbound REST polling) with stack..."
      "${COMPOSE_DEBUG[@]}" up -d worker-rest-poller
      "${COMPOSE_DEBUG[@]}" up
      ;;
    api)
      echo "[run.sh] Note: no worker containers — worker-ingest / worker-scrubber not started (no data_objects from Kafka)."
      echo "[run.sh] For pipeline: ./run.sh debug ingest   or   docker compose up -d worker-ingest worker-scrubber"
      "${COMPOSE_DEBUG[@]}" up api frontend
      ;;
    workers)
      "${COMPOSE_DEBUG[@]}" up \
        api \
        mosquitto \
        worker-mqtt-bridge \
        worker-rest-poller \
        worker-device-liveness \
        worker-ingest \
        worker-scrubber \
        worker-workflow \
        worker-publish \
        worker-ai \
        scheduler
      ;;
    ai)
      "${COMPOSE_DEBUG[@]}" up api frontend worker-ai scheduler
      ;;
    ingest)
      "${COMPOSE_DEBUG[@]}" up api worker-rest-poller worker-device-liveness worker-ingest worker-scrubber
      ;;
    *)
      echo "[run.sh] Unknown debug mode: $mode" >&2
      usage
      exit 1
      ;;
  esac
}

cmd_up() {
  shutdown_all
  echo "[run.sh] Optional: compile frontend (set SKIP_FRONTEND_BUILD=1 to skip)..."
  if [[ "${SKIP_FRONTEND_BUILD:-0}" != "1" ]]; then
    compile_frontend
  else
    echo "[run.sh] SKIP_FRONTEND_BUILD=1 — skipping npm ci / npm run build"
  fi
  export LOG_LEVEL="${LOG_LEVEL:-INFO}"
  echo "[run.sh] docker compose build..."
  "${COMPOSE_BASE[@]}" build
  echo "[run.sh] docker compose up -d (all services in docker-compose.yml default project)"
  if [[ -n "${COMPOSE_PROFILES:-}" ]]; then
    echo "[run.sh] COMPOSE_PROFILES=${COMPOSE_PROFILES} (ingress / llm extras)"
  fi
  "${COMPOSE_BASE[@]}" up -d
  "${COMPOSE_BASE[@]}" up -d worker-rest-poller
  echo "[run.sh] UI:  http://localhost:5173"
  echo "[run.sh] API: http://localhost:8000  (OpenAPI: /docs)"
  echo "[run.sh] Tip: REST outbound polling logs — ./run.sh rest-poller   or   docker compose logs -f worker-rest-poller"
}

cmd_down() {
  shutdown_all
}

cmd_rest_poller() {
  echo "[run.sh] Rebuild and start worker-rest-poller (polls device_endpoints with rest_mode=polling)..."
  "${COMPOSE_BASE[@]}" up -d --build worker-rest-poller
  echo "[run.sh] Following logs (Ctrl+C stops tail only; container keeps running)..."
  "${COMPOSE_BASE[@]}" logs -f worker-rest-poller
}

usage() {
  cat <<'EOF'
Usage: ./run.sh <command> [args]

  debug [all]     Stop everything, compile frontend (except workers/ingest modes), rebuild,
                  start stack in foreground with debug profile:
                  AAR_DEBUG=true AAR_LOG_LEVEL=debug AAR_TRACE_PIPELINE=true AAR_LOG_JSON=true
                  API logs as JSON lines (aar.* fields); uvicorn --log-level debug; Vite --debug.

  debug api       Same as debug but only infra + api + frontend (no workers — no data_objects pipeline).

  debug workers   Infra + api + mosquitto + worker-mqtt-bridge + other workers + scheduler (no frontend).

  debug ai        Infra + api + frontend + worker-ai + scheduler.

  debug ingest    Infra + api + worker-rest-poller + worker-ingest + worker-scrubber
                  (REST polling → raw.ingest → data_objects).

  up | all        Same: stop everything, compile frontend (unless SKIP_FRONTEND_BUILD=1), rebuild,
                  docker compose up -d — full default stack (api, frontend, workers, infra, etc.).
                  Alias `all` is for convenience. Optional: COMPOSE_PROFILES=ingress,llm to add CoAP/WebSocket
                  ingress workers (REST poller is in the default stack) and Ollama (see docker-compose.yml profiles).

  down            Stop compose stacks, then kill listeners on published stack ports (API 8000,
                  Vite 5173, Kafka 9092, MinIO 9000/9001, Postgres 5433/5434, Redis 16379, MQTT host port
                  18883 (or MQTT_BROKER_PUBLISH_PORT from .env). Set RUN_SH_KILL_PORTS for extras.

  rest-poller     docker compose up -d --build worker-rest-poller, then logs -f worker-rest-poller
                  (Manage Devices → HTTP/REST → Outbound polling).

Logging rules:
  Passwords, tokens, secrets, and full connection strings are never logged by app code (masked URLs only).
  Optional: KAFKA_PYTHON_DEBUG=1 for kafka-python internals (very noisy).

  Ollama: add profile when needed, e.g. COMPOSE_PROFILES=llm docker compose -f docker-compose.yml -f docker-compose.debug.yml --profile llm up
  Optional env.sh in repo root is sourced automatically (e.g. OLLAMA_MODEL); same exports apply to docker compose substitution when using ./run.sh.
EOF
}

case "${1:-}" in
  debug)
    shift
    cmd_debug "${1:-all}"
    ;;
  up|all) cmd_up ;;
  down) cmd_down ;;
  rest-poller) cmd_rest_poller ;;
  -h|--help|help) usage ;;
  *)
    usage
    exit 1
    ;;
esac
