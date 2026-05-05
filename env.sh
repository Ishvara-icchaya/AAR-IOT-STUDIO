# Local overrides sourced by ./run.sh (optional). Safe to commit non-secret defaults.
# Docker Compose substitutes exported vars into the api service when you use ./run.sh.
#
# Ollama on the same machine as this repo is normal. URL still depends on where the API runs:
#   • API in Docker → Ollama on host: use http://host.docker.internal:11434 (Compose sets extra_hosts on api).
#   • API on the host (uvicorn): use http://127.0.0.1:11434 — localhost inside a container is NOT the host.
#
# If `docker compose exec api` cannot reach host.docker.internal:11434 but curl on the host works, Ollama is
# likely bound to 127.0.0.1 only. Bind on all interfaces, then restart Ollama, e.g. export OLLAMA_HOST=0.0.0.0:11434
# (systemd: Environment= in an ollama drop-in). Then retry exec api → /api/tags.

export OLLAMA_MODEL=llama3.2:latest
# Optional: faster follow-up prompts (keeps weights resident); use -1 only if VRAM allows.
# export OLLAMA_REQUEST_KEEP_ALIVE=30m
# export OLLAMA_NUM_PREDICT=768
# export OLLAMA_TEMPERATURE=0.2
# API in Docker → Ollama on this machine (Compose maps host.docker.internal on the api service).
# If you run the API on the host instead (uvicorn), comment the next line and use: export OLLAMA_BASE_URL=http://127.0.0.1:11434
export OLLAMA_BASE_URL=http://host.docker.internal:11434
