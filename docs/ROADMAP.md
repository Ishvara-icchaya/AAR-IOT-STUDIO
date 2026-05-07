# Operational lineage and versioning backlog

Post–**8.0.0** follow-ups aligned with [DEVICE_VERSIONING_SPEC.md](./DEVICE_VERSIONING_SPEC.md).

## Delivered in mainline (verify in your deployment)

1. **Version-timeline lineage (§15)** — Table-backed `device_version_lineage` with KPI snapshots; **explicit** cuts from `PATCH /devices` when `device_version` changes; **OTA readiness** per §16.3 when `ota_supported` changes (auto label bump + `trigger_code=ota`); **ingest contract** on `PATCH …/device_objects` when the field-catalog / frozen-scrubber fingerprint changes (`ingest_shape`, requires `devices.write`); bootstrap and CSV import ensure a first row; `GET /devices/{id}/version-lineage` merges live footprint KPIs for the current label.

2. **Lineage ↔ version history** — Operational lineage UI: footprint modal, version timeline, KPI compare with `compareA` / `compareB` in the URL, deep links to the register table with the version-history drawer, and drawer **Compare KPIs** linking back with lineage-derived compare params.

3. **Richer `GET /devices/{id}/footprint`** — Workflow association scans **all** nodes for `device_id`, `endpoint_id`, `resolved_device_id`, and `latest_device_state_id`; each workflow row includes `site_id` and `definition_version`. Dashboard references include **`site_id`** as well as id, name, and status.

## Still open (schedule by milestone)

- **OTA job completion (§13 row 3)** — Record lineage rows with `ota_external_ref` (and version semantics) when a campaign/job completion path exists in the product stack, not only Tab 3 `ota_supported` toggles.
- **Bootstrap commit semantics** — Replace read-path internal `commit()` in `ensure_bootstrap_lineage_row()` with caller-owned transactions when session boundaries matter; see **DEVICE_VERSIONING_SPEC.md §15.1**.
- **Compare / simulation / promote–rollback** — Keep registration lightweight (**§16.6**); deepen compare and simulation on **Device details** / lineage as those surfaces ship.
