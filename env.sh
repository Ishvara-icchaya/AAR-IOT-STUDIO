# Local overrides sourced by ./run.sh (optional). Safe to commit non-secret defaults.
# Docker Compose substitutes exported vars into the api service when you use ./run.sh.

export OLLAMA_MODEL=llama3.2:latest
# Optional: faster follow-up prompts (keeps weights resident); use -1 only if VRAM allows.
# export OLLAMA_REQUEST_KEEP_ALIVE=30m
# export OLLAMA_NUM_PREDICT=768
# export OLLAMA_TEMPERATURE=0.2
# API in Docker reaching Ollama on the host (uncomment if needed):
# export OLLAMA_BASE_URL=http://host.docker.internal:11434
