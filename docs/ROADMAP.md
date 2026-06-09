# Operational lineage and versioning backlog

**Consolidated requirements (v1–v8+, Dashboard, Enterprise AI):** [CONSOLIDATED_REQUIREMENTS.md](./CONSOLIDATED_REQUIREMENTS.md).

**Version 8 objectives — complete** (lineage + immutable versions + static impact + replay simulation MVP + RBAC/audit foundations + UI permission gates; see git history around migrations **`0045`–`0047`** and related API/UI). Ongoing work is **post–v8** polish and net-new features below.

Post–**8.0.0** follow-ups aligned with [DEVICE_VERSIONING_SPEC.md](./DEVICE_VERSIONING_SPEC.md). Objectives and architecture overview: [DEVICE_VERSION_GOVERNANCE_DESIGN.md](./DEVICE_VERSION_GOVERNANCE_DESIGN.md).

**Locked implementation phases** (immutable versions, lineage extension, routing, UI, RBAC, audit): [DEVICE_VERSIONING_SPEC.md](./DEVICE_VERSIONING_SPEC.md).

## Delivered in mainline (verify in your deployment)

1. **Version-timeline lineage (§15) + Phases 1–3 (OTA plan)** — Table-backed `device_version_lineage` with generalized columns (`event_type`, `source_type`, `status`, `target_device_version_id`, `previous_device_version_id`, `payload_json`, `created_by`, `ota_campaign_id`); immutable **`device_versions`** table with backfill from `devices`; KPI snapshots; **explicit** / **OTA readiness** / **ingest_shape** cuts create new `device_versions` rows and lineage links; bootstrap uses **caller `commit()`** (no internal commit on bootstrap); CSV import and register commit after bootstrap; `GET …/version-lineage` **commits** after bootstrap read so first row persists.

2. **Lineage ↔ version history** — Operational lineage UI: footprint modal, version timeline, KPI compare with `compareA` / `compareB` in the URL, deep links to the register table with the version-history drawer, and drawer **Compare KPIs** linking back with lineage-derived compare params.

3. **Richer `GET /devices/{id}/footprint`** — Workflow association scans **all** nodes for `device_id`, `endpoint_id`, `resolved_device_id`, and `latest_device_state_id`; each workflow row includes `site_id` and `definition_version`. Dashboard references include **`site_id`** as well as id, name, and status.

4. **OTA campaigns + candidate routing (Phases 4–7)** — Migration **`0042`**: `ota_campaigns`, `ota_campaign_targets`, `ota_events`; `device_versions.routing_lane` / `compatibility`; candidate mirror tables. **`0043`**: RBAC rows for `device_versions.*`, `simulation.run`, and legacy OTA keys on `device_operator`. **`POST /api/v1/device-versions/{id}/promote`**, **`/isolate`**, **`/rollback`** with matching lineage events. Worker resolution writes **`candidate_latest_device_state`** when the active version is on the candidate lane instead of shared **`latest_device_state`**. *(OTA campaign REST/UI and executor poll paths were removed from the application tree; related DB tables may still exist from migrations.)*

5. **Device Details UI + static impact (Phases 8–9)** — **`/devices/detail/:deviceId`** hub (Overview, Versions, Lineage, **Simulation** tab calling **`POST /simulations/replay`**). APIs: **`GET /api/v1/devices/{id}/device-versions`**, **`GET …/device-versions/{version_id}/impact`** (baseline = prior **active** row; field diff; **per-widget attribute/metric refs vs device field catalog** for `data_object`-bound widgets; workflows + dashboards blast radius; schema drift notes). Registration stays minimal; table links to the hub.

6. **OTA campaign control plane + UI** — **Removed** from the current product codebase (no **`/api/v1/ota/*`**, no **`/devices/ota`** UI). Historical migrations (**`0042`**, **`0044`**, **`0049`**, etc.) may still create OTA-related tables and permission rows in existing databases.

7. **Phase 10 + 12–13 (MVP in tree)** — **`simulation_jobs`**, **`POST /simulations/replay`** / **`GET /simulations/{id}`**; **`control_plane_audit_events`**, **`GET /audit/events`**, UI **Administration → Control plane audit**; catalog keys **`lineage.read`**, **`audit.read`**, **`device_versions.deprecate`**, **`POST /device-versions/{id}/deprecate`**; version lifecycle **audit emits**; **`docs/CANDIDATE_LANE_CONSUMERS.md`**.

## Still open (post–v8 / next milestones)

Follow **[DEVICE_VERSIONING_SPEC.md](./DEVICE_VERSIONING_SPEC.md)** for governance and lineage narrative. Short list:

### Scrubber — **Decode Series** (spec locked; v1 implemented)

- **Locked spec:** [SCRUBBER_DECODE_SERIES_SPEC.md](./SCRUBBER_DECODE_SERIES_SPEC.md) — generic `step_type: decode_series` (no Base64-only primitive); v1 modes `scalar`, `array`, `base64_binary`, `csv_numbers`, `hex_binary`; standard `{ samples, meta, aggregations }` output; validation, error codes, and security limits as documented.
- **Runtime:** `decodeSeriesSteps` on `scrubberStudio.draft` / `publishedBody` — worker + API `run_scrubber` (`scrubber_decode_series.py`); order: after `scalarFields`, before `functionBased`. Studio live preview mirrors logic in `scrubberDecodeSeries.ts`. API tests: `tests/test_scrubber_decode_series.py`.
- **Deferred modes** (same step family, future): `object_array`, `timestamp_value_pair`, `gzip_base64_binary`, protobuf / schema-packed binary — listed under *Scrubber → to be supported modes* in that spec.

- **Firmware artifact library** — First-class binaries / manifests and OTA binding beyond free-text target FW.
- **Simulation depth** — Full scrubber/workflow re-execution vs current structural + static-impact MVP.
- **Dashboard live candidate lane** — Read path for widgets against **`candidate_latest_device_state`** (see [CANDIDATE_LANE_CONSUMERS.md](./CANDIDATE_LANE_CONSUMERS.md)).
- **Audit + RBAC hardening** — Broader **`audit.read`** grants, richer audit payloads, and any remaining API/UI action → permission mapping.

## Retire / legacy

Backlog from a codebase pass (dead code, duplicates, and paths that need a migration plan before removal).

### Safe cleanup (low risk)

- **Frontend CSS** — Remove unused **`.ops-status-badge`** rules in `services/frontend/src/index.css` (status UI is `AarStatusPill` / `OpsStatusPill` only; no TSX references to the old classes).
- **Worker stubs** — `services/workers/app/ai_suggestions.py` and `services/workers/app/ai_maintenance.py` are Phase‑1 no-ops: not referenced by `ai_worker.py`, not a Compose `command`. **Remove** or replace with a short note in `ai_worker.py` until async AI jobs exist.
- **Thin re-export** — `services/frontend/src/pages/ScrubberCreatePage.tsx` only re-exports `ScrubberStudioPage`; optional **delete** and import `ScrubberStudioPage` directly from `App.tsx`.

### Consolidation (keep behavior; reduce drift)

- **`LEGACY_MQTT_BRIDGE_LAST_INGEST_REDIS_KEY`** — Duplicated in `services/workers/app/ingest_archive.py` and `services/workers/app/monitoring_probes.py` (monitoring still reads it). **Single shared constant** (e.g. small `legacy_redis_keys` module) so keys cannot diverge.

### Do not remove until product / tenant migration

- **`DataObject` and dashboard / published-service `data_object` sources** — API routes and models remain for legacy bindings; v2 policy already discourages `data_object` widgets in places. **Retirement** = coordinated API deprecation + tenant rebinds, not a blind delete.
- **Dual scrubber entry points** — **`/scrubber/create`** (classic `ScrubberStudioPage`) vs **`/scrubber/v2/create`** (`Scrubber2Page`). Retire classic UI only after **redirect + comms** and confirmation nothing depends on the old route alone.
- **`scheduler` / `worker-ai` Compose services** — Idle scaffolds with heartbeats; not redundant modules; replace only when real scheduled or async AI work replaces the placeholder loops.
