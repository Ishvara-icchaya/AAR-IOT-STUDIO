# AAR IoT Studio

**Open-source, on-premises industrial IoT operations platform.**

AAR IoT Studio ingests device telemetry over standard protocols, archives raw payloads, transforms them through published scrubber pipelines, and exposes fleet health through dashboards, maps, workflows, alerts, and governed Enterprise AI. Device versions are **immutable** and promoted through explicit operator activation—so schema and firmware changes do not silently break production KPIs.

[Apache License 2.0](LICENSE)

## Features

- **Multi-protocol ingest** — MQTT, HTTP (push and pull), WebSocket, and listener-style adapters; every message archived before processing
- **Endpoint-first identity** — Device endpoints as the canonical binding; resolved devices and latest state for operational reads
- **Scrubber Studio** — Draft, compile, and publish pipelines; decode-series steps; semantic field catalog for KPIs and AI
- **Dashboards and maps** — Frozen live dashboards, endpoint-group widgets, map trends, and expanded fleet intelligence
- **Device version governance** — Detection from live traffic, impact analysis, lineage, replay simulation, and **Activate Version** promotion
- **Workflows and publishing** — Automation graphs, outbound publish paths, unified alerts
- **Enterprise AI** — Structured, catalog-grounded evidence; optional LLM summarization when enabled
- **On-prem stack** — Docker Compose: FastAPI, React, Postgres, TimescaleDB, Redis, MinIO, Kafka (KRaft), workers

## Architecture

```text
Devices → raw archive → Kafka → workers → scrubber → latest state
                                              ↓
                         workflows · dashboards · maps · AI · alerts
```

| Layer | Technology |
|-------|------------|
| API | FastAPI |
| UI | React + Vite |
| Metadata | PostgreSQL |
| Time series | TimescaleDB |
| Cache / live state | Redis |
| Raw blobs | MinIO |
| Streaming | Kafka (KRaft) |
| Workers | ingest, scrubber, workflow, publish, AI, scheduler |
| LLM (optional) | Ollama |

## Prerequisites

- Docker with Compose v2

## Quick start

```bash
cp .env.example .env
docker compose up -d --build
```

| URL | Service |
|-----|---------|
| http://localhost:5173 | Web UI |
| http://localhost:8000 | API (OpenAPI at `/docs`) |
| `GET /health` | Health check |

### Helper script

```bash
./run.sh debug   # tear down, rebuild frontend + images, foreground stack (DEBUG logs)
./run.sh up      # detached stack (set SKIP_FRONTEND_BUILD=1 to skip npm build)
./run.sh down    # stop stack and free ports 8000 / 5173
```

Debug mode sets `LOG_LEVEL=DEBUG` for Python services, uvicorn access logs, and Vite debug output.

### Default host ports

| Service | Port | Notes |
|---------|------|-------|
| Frontend | 5173 | Vite in container |
| API | 8000 | |
| Postgres | 5434 | Avoids local 5432 conflicts |
| TimescaleDB | 5433 | |
| Redis | 16379 | Avoids local Redis conflicts |
| MinIO | 9000 | Console on 9001 |
| Kafka | 9092 | `apache/kafka` KRaft image |

### Optional LLM

```bash
docker compose --profile llm up -d ollama
```

## Repository layout

```text
services/
  api/        FastAPI application and migrations
  frontend/   React SPA (navigation, dashboards, device management, scrubber)
  workers/    Kafka consumers (ingest, scrubber, workflow, publish, AI, …)
docs/         Product specs, contracts, and design notes
```

From the repo root:

```bash
npm install --prefix services/frontend
npm run build      # production frontend build
npm run dev        # frontend dev server (with API running separately or in Compose)
npm run lint
```

Workers subscribe to canonical topics (`raw.ingest`, `scrubber.input`, …). The API bootstraps Kafka topics on startup.

## Local development (without full Compose for app code)

**API**

```bash
cd services/api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql://...   # e.g. dockerized Postgres on 5434
uvicorn app.main:app --reload --port 8000
```

**Frontend**

```bash
cd services/frontend
npm install && npm run dev
```

Set `VITE_API_BASE_URL` in `services/frontend/.env` if the API is not at `http://localhost:8000/api/v1`.

## Documentation

| Topic | Location |
|-------|----------|
| Platform purpose and customer translation | `docs/PLATFORM_FUNCTIONALITY.md` |
| Requirements v1–v8+ | `docs/CONSOLIDATED_REQUIREMENTS.md` |
| Enterprise baseline (navigation, scrubber, restore) | `docs/ENTERPRISE_FEATURES_EXPORT_UPDATED.md` |
| Ingest and device identity | `docs/CANONICAL_INGRESS_PRODUCT.md` and related canonical docs |
| Device versioning | `docs/DEVICE_VERSIONING_SPEC.md` |
| Dashboard widget runtime | `docs/DASHBOARD_WIDGET_CONTRACT.md` |

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, expectations, and how to open issues and pull requests.

## Security

Do not commit `.env` or credentials. For production deployments, restrict network exposure (especially UDP listeners), configure authentication on ingest APIs, and use customer-owned map tile endpoints for air-gapped sites. Report security concerns through your fork’s issue tracker or the channel your maintainers publish.

## License

Copyright 2026 AAR IoT Studio Contributors.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
