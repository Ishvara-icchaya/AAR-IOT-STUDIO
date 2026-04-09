# AAR-IoT-Studio

Phase 1 on-prem platform scaffold aligned with `docs/ENTERPRISE_FEATURES_EXPORT_UPDATED.md`: **FastAPI** API, **React + Vite** UI, **Postgres** (metadata), **TimescaleDB** (time-series), **Redis**, **MinIO**, **Kafka (KRaft, no ZooKeeper)**, and **worker** containers.

## Prerequisites

- Docker with Compose v2

## Quick start

```bash
cp .env.example .env
docker compose up -d --build
```

### `run.sh` (shutdown, compile, start)

```bash
./run.sh debug   # tear down stack + free ports 8000/5173, npm build frontend, rebuild images, compose up (foreground, DEBUG)
./run.sh up      # same teardown + build, then detached stack (INFO logs; set SKIP_FRONTEND_BUILD=1 to skip npm build)
./run.sh down    # compose down + free 8000/5173
```

Debug mode enables **`LOG_LEVEL=DEBUG`** for Python services, **uvicorn `--log-level debug --access-log`**, **Vite `--debug`**, and **`VITE_DEBUG=true`** for browser `console.debug` via `src/lib/debug.ts`.

- **UI:** [http://localhost:5173](http://localhost:5173) (primary shell + routes from the baseline)
- **API:** [http://localhost:8000](http://localhost:8000) — OpenAPI at `/docs`
- **Health:** `GET /health`

### Host port map (defaults)

| Service      | Host port | Notes                          |
|-------------|-----------|--------------------------------|
| Frontend    | 5173      | Vite dev server in container   |
| API         | 8000      |                                |
| Postgres    | **5434**  | Avoids clash with local 5432   |
| TimescaleDB | 5433      |                                |
| Redis       | **16379** | Avoids clash with local Redis  |
| MinIO S3    | 9000      | Console 9001                   |
| Kafka       | 9092      | **apache/kafka:3.8.1** KRaft   |

Kafka uses the **Apache** image because **Bitnami** tags are not consistently available on all registries; behavior remains KRaft-only per baseline.

### Optional LLM profile

```bash
docker compose --profile llm up -d ollama
```

## Monorepo layout

```
services/
  api/           # FastAPI — /api/v1/* routers (stubs + Kafka topic bootstrap)
  frontend/      # React, authoritative nav + routes
  workers/       # worker-ingest, scrubber, workflow, publish, ai, scheduler (scaffold)
```

Workers subscribe to canonical topics (`raw.ingest`, `scrubber.input`, …); the API creates topics on startup.

## Local development (without Docker for JS/Python)

```bash
# API
cd services/api && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=...  # point at dockerized Postgres if desired
uvicorn app.main:app --reload --port 8000

# Frontend
cd services/frontend && npm install && npm run dev
```

Set `VITE_API_BASE_URL` in `services/frontend/.env` if the API is not on `http://localhost:8000/api/v1`.

## Next implementation steps

1. Alembic migrations + SQLAlchemy models with `customer_id` on tenant rows.
2. Wire device registration, raw ingest → MinIO → `raw.ingest` Kafka.
3. Port **Scrubber / Workflow / Dashboard** UIs from the previous project into `services/frontend`.
4. Implement **Restore to Default** (full reset) per §0.7 — orchestration + reseed.

## License

Proprietary — assign per your organization.
