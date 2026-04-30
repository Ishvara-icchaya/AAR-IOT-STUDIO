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

From the **repo root**, `npm run build`, `npm run dev`, `npm run lint`, and `npm run lint:design` forward to `services/frontend` (run `npm install` in `services/frontend` first, or from root: `npm install --prefix services/frontend`).

Workers subscribe to canonical topics (`raw.ingest`, `scrubber.input`, …); the API creates topics on startup.

## Iteration log (recover from crashes)

If a session or machine crashes before work is merged or summarized elsewhere, **the repo should still tell the story of what changed.**

After **substantive** edits (code, migrations, config, or meaningful documentation—not one-line typos or pure Q&A), **prepend a new dated section at the top** of [`docs/ITERATION_LOG.md`](docs/ITERATION_LOG.md) (newest first). Each entry should include **date**, **what changed** (files or areas), **why / intent**, and **follow-ups** if any are open. Do not delete older sections; only add new ones at the top.

That log is the durable trail so context is not lost when tooling or hosts fail mid-flight.

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

## Dashboard endpoint-group binding (v2)

Dashboards now support endpoint-level logical groups as the default source mode:

```json
{
  "sourceType": "resolved_device_collection",
  "endpointId": "...",
  "siteId": "...",
  "objectName": "..."
}
```

- **Default in builder:** Endpoint Group
- **Advanced mode:** Individual Device
- **No `data_object` fallback** for v2 dashboard binding validation/runtime

New dashboard APIs:

- `GET /api/v1/dashboards/sources/resolved-device-collections?site_id=...`
- `GET /api/v1/dashboards/runtime/resolved-device-collection?site_id=...&endpoint_id=...&object_name=...`

Runtime collection ordering/cursor are deterministic:

- `ORDER BY updated_at DESC, scrubbed_event_id DESC, resolved_device_id ASC`
- cursor encodes `updated_at`, `scrubbed_event_id`, and `resolved_device_id`

## Recently completed

- **Endpoint Group dashboard source (default):**
  - builder source mode supports **Endpoint Group (default)** and **Individual Device (advanced)**;
  - default bindings for key widgets (`kpi`, `table`, `chart`, `device_tile`) now use `resolved_device_collection`;
  - endpoint-group source list/runtime APIs are live under `/api/v1/dashboards/sources/resolved-device-collections` and `/api/v1/dashboards/runtime/resolved-device-collection`.
- **Runtime guards and policy:**
  - v2 dashboard validation/runtime enforces no `data_object` fallback;
  - endpoint/site coherence checks added for endpoint-group bindings.
- **Acceptance tests (endpoint-group):**
  - coverage includes source policy, required binding fields, cursor contract, status bucket mapping, auto-reflecting device cohort changes, pagination aggregation, map latest-device-state source usage, and OpenAPI route presence.
- **Dashboard Edit / Configure Widget UX:**
  - 3-column configure layout (settings, preview, debug JSON);
  - preview clipping fixes for sticky panel/body scrolling and KPI-strip title enclosure in widget frame CSS.

## Next implementation steps

1. Implement **Restore to Default** (full reset) per §0.7 — orchestration + reseed.

## License

Proprietary — assign per your organization.
