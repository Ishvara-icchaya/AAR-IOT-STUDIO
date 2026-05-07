# Operational lineage and versioning backlog

Post–**8.0.0** follow-ups aligned with [DEVICE_VERSIONING_SPEC.md](./DEVICE_VERSIONING_SPEC.md).

**Locked implementation phases** (OTA, immutable versions, lineage extension, routing, UI, RBAC, audit): [OTA_VERSION_LINEAGE_PHASES.md](./OTA_VERSION_LINEAGE_PHASES.md).

## Delivered in mainline (verify in your deployment)

1. **Version-timeline lineage (§15) + Phases 1–3 (OTA plan)** — Table-backed `device_version_lineage` with generalized columns (`event_type`, `source_type`, `status`, `target_device_version_id`, `previous_device_version_id`, `payload_json`, `created_by`, `ota_campaign_id`); immutable **`device_versions`** table with backfill from `devices`; KPI snapshots; **explicit** / **OTA readiness** / **ingest_shape** cuts create new `device_versions` rows and lineage links; bootstrap uses **caller `commit()`** (no internal commit on bootstrap); CSV import and register commit after bootstrap; `GET …/version-lineage` **commits** after bootstrap read so first row persists.

2. **Lineage ↔ version history** — Operational lineage UI: footprint modal, version timeline, KPI compare with `compareA` / `compareB` in the URL, deep links to the register table with the version-history drawer, and drawer **Compare KPIs** linking back with lineage-derived compare params.

3. **Richer `GET /devices/{id}/footprint`** — Workflow association scans **all** nodes for `device_id`, `endpoint_id`, `resolved_device_id`, and `latest_device_state_id`; each workflow row includes `site_id` and `definition_version`. Dashboard references include **`site_id`** as well as id, name, and status.

## Still open (schedule by milestone)

Follow **[OTA_VERSION_LINEAGE_PHASES.md](./OTA_VERSION_LINEAGE_PHASES.md)**. Phases **1–3** are implemented in tree (bootstrap caller commit, generalized lineage columns, **`device_versions`**). Next: **Phase 4** (`ota_campaigns` / `ota_campaign_targets`) before OTA execution (**5+**).

Short list:

- **Phase 4** — `ota_campaigns`, `ota_campaign_targets`, optional `ota_events`.
- **Phases 5–7** — OTA completion API/service, version promote/isolate/rollback, candidate lane routing.
- **Phases 8–11** — Device Details UI, compare/impact/replay, OTA campaign UI.
- **Phases 12–13** — RBAC keys for OTA/versioning/simulation/lineage; audit trail separate from lineage.
