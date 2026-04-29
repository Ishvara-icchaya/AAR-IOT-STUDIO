# Iteration log (append-only)

Purpose: durable trail of **what changed and why**, so work survives editor crashes and context loss.  
Convention: add a **new section at the top** (newest first) per session or logical batch of work.

---

## 2026-04-28 — Split `ba8d19c` into five commits (crash-safer history)

Replaced single squash with sequential commits on `v2-endpoints-rebuild`:

1. `cc8fce9` — **Capture endpoint samples before identity mapping** (migration `0031` columns, model, worker ingest + CoAP bound path, REST raw sample + Kafka gate, `endpoint_sample_service`).
2. `cf9805c` — **Add endpoint identity publish lifecycle** (schemas, `endpoints` publish + draft PATCH, `endpoint_identity_publish`, `primary_device_key` API copy, `v2_resolution` publish guard, OpenAPI route tests).
3. `fa0321e` — **Add endpoint identity mapping UI** (React route, ingest table link, API client).
4. `cd8dddb` — **Enforce v2 dashboard workflow and AI sources** (dashboard validation, map eligible list, AI datasets, workflow graph validation + create/update checks).
5. **Add v2 endpoint identity lifecycle tests** — `test_v2_endpoint_identity_lifecycle.py` + this log (same commit as message `Add v2 endpoint identity lifecycle tests` on `v2-endpoints-rebuild`).

**Push:** This clone has no `git remote`; configure `origin` then `git push origin v2-endpoints-rebuild` after each slice locally if desired.

---

## 2026-04-28 — Step 1: foundation commit (`710a0d2`)

**Commit:** `Rebuild v2 endpoint foundation and MQTT binding` — `710a0d2` on `v2-endpoints-rebuild`.

**Staged paths:** `services/api`, `services/workers`, `services/frontend` (per recovery plan).

**Pre-commit checks:**

- `npm run build` in `services/frontend` — pass.
- `docker compose exec api alembic upgrade head` — DB at `0030_endpoint_lifecycle_sample (head)`.
- `docker compose exec api python -c "from app.main import app"` — pass.
- `python3 -m py_compile` on touched API/worker modules — pass.
- `pytest tests/test_v2_endpoint_schemas.py` (host `.venv` in `services/api`) — 5 passed.

**Includes (high level):** migrations `0029`/`0030`, endpoint lifecycle + nullable PK + MQTT v2 ingest archive path, ingest quarantine for unbound/device-only, `v2_resolution` guard without PK fields, tenant operational clear async (Redis job) + related API/UI, assorted frontend layout/dashboard/vite chunking.

**Next (recovery plan):** Step 2 — sample capture across protocols; Step 3 — activate endpoint only from Scrubber 2.0 publish; Step 4 — Scrubber identity UI; Step 5 — v2 read-model boundaries; Step 6 — acceptance tests.

---

## 2026-04-28 — Baseline + tracking setup

**Context:** Cursor crash recovery; user asked to track changes going forward.

**Repo / branch:** `v2-endpoints-rebuild` (per earlier `git status`); large **uncommitted** set remained (API, workers, frontend, migrations `0029`/`0030`, `tenant_operational_clear_job.py`).

**Product audit (approved ingest/identity plan vs code):**

- Present: endpoint schema/model for `lifecycle_status`, `sample_payload`, `sample_ingested_at` (migration `0030`); nullable `primary_device_key_fields`; strict ingest quarantine for unbound/device-only; MQTT v2 archive path; `v2_resolution` writes v2 rows only when PK fields extract successfully; scope checks vs endpoint row.
- Missing / partial: no workers writing `sample_payload`; lifecycle `needs_sample` / `error` unused; `active` not tied to Scrubber 2.0 publish; CoAP still calls rejected unbound ingest; Scrubber UI not wired to endpoint sample; acceptance tests not covering full flow.

**This commit:** Added `docs/ITERATION_LOG.md` and `.cursor/rules/iteration-log.mdc` so agents append here after substantive edits.

---
