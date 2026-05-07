# OTA / Version / Lineage — Locked Implementation Phases

This document is the **implementation sequencing contract** for OTA execution, immutable device versions, generalized lineage, routing, and UI. It extends [DEVICE_VERSIONING_SPEC.md](./DEVICE_VERSIONING_SPEC.md) and [ROADMAP.md](./ROADMAP.md).

---

## Final sequencing rule

**Do not implement OTA execution** (Phase 5 onward in the sense of live campaign completion and promotion) **before**:

1. **Generalized lineage** (Phase 2) — extend `device_version_lineage`; no parallel lineage table.
2. **Immutable `device_versions`** (Phase 3) — first-class version rows with stable IDs.
3. **`ota_campaign_targets`** (Phase 4) — campaign and per-target state exist and are authoritative for completion callbacks.

---

## Final principle

- **Readiness metadata** — What a device *can* support (`ota_supported`, `rollback_supported`, `firmware_channel`, declared `firmware_version`, thresholds).
- **OTA completion** — What *actually happened* when a job/campaign terminal state is reached.
- **Device versions** — Immutable state snapshots (no in-place mutation of version rows).
- **Lineage** — Explains lifecycle (events on the data/device path).
- **Routing** — Protects production (shared vs candidate lane).

---

## Phase 0 — Current baseline

**Device readiness metadata** (on `devices`):

- `firmware_version`, `firmware_channel`, `ota_supported`, `rollback_supported`, thresholds.

**Current lineage** (`device_version_lineage`):

- `trigger_code` examples: `explicit`, OTA readiness (`ota`), `ingest_shape`, `bootstrap`.

**Not yet implemented:**

- Real OTA campaigns.
- Immutable `device_versions` table.
- OTA **job/campaign completion** lineage (`ota_job_completed`).
- Promote / isolate / rollback services.
- Simulation and replay engines.
- Candidate lane stores vs shared `latest_device_state`.

---

## Phase 1 — Bootstrap lineage cleanup

- Refactor `ensure_bootstrap_lineage_row()`.
- **Remove** internal `db.commit()`; use `db.flush()` (and return row where useful).
- **Caller owns** `commit()`.
- Update tests and document behavior (see DEVICE_VERSIONING_SPEC.md §15.1 for prior v1 note).

**Status:** Implemented — `GET …/version-lineage`, `register_device`, and import commit after bootstrap; no internal `commit()` in the helper.

---

## Phase 2 — Generalized lineage event model

**Decision — locked:** **Extend** `device_version_lineage` instead of creating a parallel lineage table.

Add or standardize columns (names subject to DB migration but semantics fixed):

| Concern | Purpose |
|--------|---------|
| `event_type` | High-level lifecycle category (see list below). |
| `trigger_code` | Fine-grained trigger (may align with or refine today’s codes). |
| `source_type` | Origin of the change (`api`, `ota`, `user`, `system`, …). |
| `source_id` | Correlation id (command, campaign, job, request). |
| `status` | Outcome / phase for this event where applicable. |
| `previous_device_version_id` | FK-style uuid to prior **`device_versions`** row (nullable until Phase 3 backfill). |
| `target_device_version_id` | FK-style uuid to target **`device_versions`** row. |
| `ota_campaign_id` | Nullable until OTA exists. |
| `ota_external_ref` | External correlation string. |
| `payload_json` | Structured event payload (diffs, MQTT snapshot, errors). |
| `created_by` | User id for human-initiated events. |

**Event types** (`event_type` enumeration — extend as needed):

- `device_registered`
- `metadata_updated`
- `endpoint_attached`
- `scrubber_associated`
- `workflow_associated`
- `dashboard_associated`
- `ota_job_completed`
- `version_promoted`
- `version_isolated`
- `version_rolled_back`
- `simulation_completed`

Existing rows remain valid; migrations map legacy `trigger_code` → `event_type` / `trigger_code` as needed.

**Status:** Implemented in migration **`0041_device_versions_and_lineage_events`** (columns + backfill `event_type` from `trigger_code`).

---

## Phase 3 — Immutable device versions

Create **`device_versions`** (first-class table).

**Core fields (locked semantics):**

- `device_version_id` (PK)
- `resolved_device_id` (nullable until bound)
- `previous_device_version_id`
- `firmware_version`, `hardware_version`, `config_version`, `endpoint_version`, `scrubber_version`, `schema_version`
- `manifest_hash`
- `version_source` — `ota` \| `manual` \| `external` \| `system`
- `firmware_channel` — `stable` \| `beta` \| `dev` \| `custom`
- `status` — see lifecycle below
- `created_at`, `created_by`, `activated_at`, `deprecated_at`

**Rules — locked:**

1. **No in-place mutation** of a `device_versions` row after creation (corrections = new row + lineage).
2. **Every material change** creates a new row (firmware, scrubber/schema, endpoint attachment policy per product rules).
3. **`devices.device_version`** may remain **operator display / cache** of the active label, but **authoritative** state is `device_versions`.

**Backfill:**

- One initial `device_versions` row per existing device, linked from lineage Phase 2 fields when populated.

**Status:** Implemented — table **`device_versions`** + migration backfill; new transitions append rows; API exposes `target_device_version_id` / `previous_device_version_id` on lineage items.

**Version statuses** (align UI and API enums):

`draft` → `candidate` → `pending_review` → `approved` → `active`; branches: `isolated`, `failed`, `rolled_back`, `deprecated` (exact graph in product spec; enums locked at API boundary).

---

## Phase 4 — OTA campaign data model

**Tables:**

- `ota_campaigns`
- `ota_campaign_targets`
- Optional `ota_events` (audit stream / MQTT log)

**Campaign statuses:**

`draft`, `simulation_required`, `pending_approval`, `approved`, `running`, `paused`, `completed`, `failed`, `rolled_back`, `cancelled`

**Target statuses:**

`queued`, `command_sent`, `acknowledged`, `downloading`, `verifying`, `installing`, `rebooting`, `success`, `failed`, `rolled_back`, `timeout`

---

## Phase 5 — OTA completion service

- `POST /api/v1/ota/status` (exact router prefix may follow existing `app/api/v1` conventions).
- `complete_ota_target()` service.

**Responsibilities:**

- Validate campaign / target / command id.
- Update target to **terminal** status when appropriate.
- Record **`ota_job_completed`** lineage event (Phase 2 model).
- Store `ota_external_ref` when provided.
- Capture previous and target **device_versions** ids and firmware strings.
- **Do not auto-promote** unless policy explicitly allows (default: manual or policy-gated promote).

---

## Phase 6 — Version lifecycle services

**Services:** promote, isolate, rollback, deprecate.

**APIs (locked paths):**

- `POST /api/v1/device-versions/{id}/promote`
- `POST /api/v1/device-versions/{id}/isolate`
- `POST /api/v1/device-versions/{id}/rollback`

**Lineage events:** `version_promoted`, `version_isolated`, `version_rolled_back`.

---

## Phase 7 — Safe routing / candidate lane

**Shared pipeline** when: `approved` + `active` + compatible (per policy).

**Candidate lane** when: `candidate`, `pending_review`, breaking / warning path, `custom` unvalidated, simulation incomplete, etc.

**Rule — locked:** candidate versions **must not** update shared **`latest_device_state`**.

**Candidate stores** (physical or logical namespaces):

- `candidate_latest_device_state`
- `candidate_scrubbed_events`
- `candidate_workflow_results`

---

## Phase 8 — Device Details UI

**Tabs:** Overview, Versions, Lineage, OTA History, Simulation.

**Actions:** Compare Versions, Run Simulation, Promote, Isolate, Rollback, View Impact.

**Rule — locked:** **Device Registration** stays minimal (identity + readiness metadata only).

---

## Phase 9 — Compare / impact engine

- `schema_diff_engine`
- Static graph impact, field diff, affected workflows, affected dashboards.

**Rules — locked:**

- **Baseline** = previous **active** `device_versions` row.
- Dashboard bindings resolve by **`schema_version` + `attribute_id`** (per DEVICE_VERSIONING_SPEC §1).
- **Impact v1** = static graph only.

---

## Phase 10 — Replay simulation

- Historical baseline data → candidate scrubber/workflow → compare outputs.

**Outputs:** records tested/passed/failed, KPI deltas, workflow/dashboard impact, recommendation.

**Rule — locked:** **Replay is authoritative**; prediction is advisory and later.

---

## Phase 11 — OTA campaign UI

Screens: Firmware Library, Create Campaign Wizard, Campaign List, Campaign Detail, Target Status Table, Rollout Timeline, Logs/Events.

Wizard stages: package → targets → compatibility → simulation → rollout plan → review & launch.

---

## Phase 12 — RBAC for OTA / versioning

Permissions (string keys — align with `permission_catalog`):

- `ota.read`, `ota.create`, `ota.approve`, `ota.launch`, `ota.rollback`
- `device_versions.read`, `device_versions.promote`, `device_versions.rollback`
- `simulation.run`
- `lineage.read`

---

## Phase 13 — Audit hardening

**Locked separation:**

- **Lineage** = what happened on the **device / data path** (immutable narrative for operators and systems).
- **Audit** = **who** did **what** in the control plane (campaign created, approved, launched, promote, rollback, manual override).

Implement audit events **separate** from lineage rows; cross-link by `source_id` where useful.

---

## Document control

| Version | Date | Note |
|--------|------|------|
| 1.0 (locked) | 2026-05-07 | Phases 0–13 and sequencing rule agreed for implementation backlog. |
| 1.1 | 2026-05-07 | **Phases 1–3 shipped in API:** migration `0041` (`device_versions` + lineage columns), bootstrap `flush` + caller `commit`, lineage rows link `target_device_version_id`, transitions insert new `device_versions` rows. |

When a phase ships, update **ROADMAP.md** “Delivered” vs “Still open” and reference this file for full phase text.
