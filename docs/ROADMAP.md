# Operational lineage and versioning backlog

Post–**8.0.0** follow-ups aligned with [DEVICE_VERSIONING_SPEC.md](./DEVICE_VERSIONING_SPEC.md).

**Locked implementation phases** (OTA, immutable versions, lineage extension, routing, UI, RBAC, audit): [OTA_VERSION_LINEAGE_PHASES.md](./OTA_VERSION_LINEAGE_PHASES.md).

## Delivered in mainline (verify in your deployment)

1. **Version-timeline lineage (§15)** — Table-backed `device_version_lineage` with KPI snapshots; **explicit** cuts from `PATCH /devices` when `device_version` changes; **OTA readiness** per §16.3 when `ota_supported` changes (auto label bump + `trigger_code=ota`); **ingest contract** on `PATCH …/device_objects` when the field-catalog / frozen-scrubber fingerprint changes (`ingest_shape`, requires `devices.write`); bootstrap and CSV import ensure a first row; `GET /devices/{id}/version-lineage` merges live footprint KPIs for the current label.

2. **Lineage ↔ version history** — Operational lineage UI: footprint modal, version timeline, KPI compare with `compareA` / `compareB` in the URL, deep links to the register table with the version-history drawer, and drawer **Compare KPIs** linking back with lineage-derived compare params.

3. **Richer `GET /devices/{id}/footprint`** — Workflow association scans **all** nodes for `device_id`, `endpoint_id`, `resolved_device_id`, and `latest_device_state_id`; each workflow row includes `site_id` and `definition_version`. Dashboard references include **`site_id`** as well as id, name, and status.

## Still open (schedule by milestone)

Follow **[OTA_VERSION_LINEAGE_PHASES.md](./OTA_VERSION_LINEAGE_PHASES.md)** for order: Phase **1** (bootstrap `commit` removal) before **2** (generalized lineage on `device_version_lineage`); **2–3–4** before OTA execution (**5+**).

Short list:

- **Phase 1** — Bootstrap lineage: caller-owned `commit`, `flush` only in `ensure_bootstrap_lineage_row()`; tests + docs (**DEVICE_VERSIONING_SPEC.md §15.1**).
- **Phases 2–4** — Generalized lineage columns + immutable **`device_versions`** + **`ota_campaigns` / `ota_campaign_targets`**.
- **Phases 5–7** — OTA completion API/service, version promote/isolate/rollback, candidate lane routing.
- **Phases 8–11** — Device Details UI, compare/impact/replay, OTA campaign UI.
- **Phases 12–13** — RBAC keys for OTA/versioning/simulation/lineage; audit trail separate from lineage.
