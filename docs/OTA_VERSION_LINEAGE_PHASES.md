# OTA / Version / Lineage — Locked Implementation Phases

This document is the **implementation sequencing contract** for OTA execution, immutable device versions, generalized lineage, routing, and UI. It extends [DEVICE_VERSIONING_SPEC.md](./DEVICE_VERSIONING_SPEC.md) and [ROADMAP.md](./ROADMAP.md).

**Version 8 — objectives met:** Phases **0–13** are either **fully delivered** or **delivered as MVP** in mainline (see snapshot below). Further work is **post–v8** (deeper simulation, firmware artifact library, live candidate reads, audit/RBAC hardening); see [ROADMAP.md](./ROADMAP.md) § *Still open*.

---

## Version 8 delivery snapshot

| Phase | Scope | Status |
|-------|--------|--------|
| **0** | Baseline readiness + legacy lineage | **Superseded** — historical; current tree implements everything listed under “Not yet implemented” in the original Phase 0 stub. |
| **1** | Bootstrap lineage (`flush`, caller `commit`) | **Complete** |
| **2** | Generalized lineage columns + `event_type` | **Complete** (+ extensions: e.g. `version_deprecated`) |
| **3** | Immutable `device_versions` | **Complete** |
| **4** | OTA campaign model | **Complete** (`0042`) |
| **5** | OTA completion + `ota_job_completed` | **Complete** |
| **6** | Promote / isolate / rollback / **deprecate** | **Complete** — deprecate: `POST /device-versions/{id}/deprecate`, lineage `version_deprecated`, RBAC `device_versions.deprecate` |
| **7** | Candidate lane + worker writes | **Complete** — see [CANDIDATE_LANE_CONSUMERS.md](./CANDIDATE_LANE_CONSUMERS.md) |
| **8** | Device Details hub | **Complete** — includes **replay** tab (`POST /simulations/replay`) |
| **9** | Static compare / impact | **Complete** — includes **per-widget** attribute/metric catalog gap for `data_object` bindings |
| **10** | Replay simulation | **MVP complete** — `simulation_jobs`, structural + KPI window diff, static impact, recommendation (`0045`+) |
| **11** | OTA UI | **v1 + polish** — wizard steps, optional replay, campaign detail timeline + summary; **Firmware Library** still deferred |
| **12** | RBAC | **Foundation complete** — catalog + migrations (`0043`, `0044`, `0046`, `0047`); UI gates use `/permissions/me?site_id=…` where needed |
| **13** | Control-plane audit | **MVP complete** — `control_plane_audit_events`, `GET /audit/events`, Admin audit page, emits on OTA lifecycle, version lifecycle, replay completion, manual device PATCH |

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

**Superseded by Phases 1–13:** the items that were “not yet implemented” at Phase 0 authoring are now covered in later phases (see **Version 8 delivery snapshot**).

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
- `version_deprecated`
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

**Status:** Implemented — migration **`0042_ota_campaigns_routing_candidate`** (`ota_campaigns`, `ota_campaign_targets`, `ota_events`).

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

**Status:** Implemented — **`POST /api/v1/ota/status`**, service `complete_ota_target()` (requires `ota.launch` on the device’s site), `ota_events` append, **`ota_job_completed`** lineage via `append_lineage_event`, campaign terminalization when all targets are terminal.

---

## Phase 6 — Version lifecycle services

**Services:** promote, isolate, rollback, deprecate.

**APIs (locked paths):**

- `POST /api/v1/device-versions/{id}/promote`
- `POST /api/v1/device-versions/{id}/isolate`
- `POST /api/v1/device-versions/{id}/rollback`
- `POST /api/v1/device-versions/{id}/deprecate`

**Lineage events:** `version_promoted`, `version_isolated`, `version_rolled_back`, `version_deprecated`.

**Status:** Implemented — all four POSTs; permissions `device_versions.promote` / `isolate` / `rollback` / **`deprecate`**; services update lifecycle fields on `device_versions` (and device pointer where applicable) and append the corresponding lineage `event_type`s. **Control-plane audit** emits for promote / isolate / rollback / deprecate (Phase 13).

---

## Phase 7 — Safe routing / candidate lane

**Shared pipeline** when: `approved` + `active` + compatible (per policy).

**Candidate lane** when: `candidate`, `pending_review`, breaking / warning path, `custom` unvalidated, simulation incomplete, etc.

**Rule — locked:** candidate versions **must not** update shared **`latest_device_state`**.

**Candidate stores** (physical or logical namespaces):

- `candidate_latest_device_state`
- `candidate_scrubbed_events`
- `candidate_workflow_results`

**Status:** Implemented — migration **`0042`** adds `routing_lane` on `device_versions` and candidate tables; worker path upserts **`candidate_latest_device_state`** when the resolved version is candidate and non-terminal (see `routing_policy` / `v2_resolution`); shared **`latest_device_state`** is skipped for that path.

---

## Phase 8 — Device Details UI

**Tabs:** Overview, Versions, Lineage, OTA History, Simulation.

**Actions:** Compare Versions, **Run replay simulation** (`simulation.run`), Promote, Isolate, Rollback, **Deprecate** (where allowed), View Impact.

**Rule — locked:** **Device Registration** stays minimal (identity + readiness metadata only).

**Status:** Implemented — route **`/devices/detail/:deviceId`** (`DeviceDetailsPage`): tabbed hub (overview cards + optional footprint, immutable versions with lifecycle + impact + **permission-gated** actions, lineage summary + compare deep-link to `/devices/lineage`, OTA target history via API, **Simulation** tab wired to **`POST /api/v1/simulations/replay`**). Registration table adds a **details hub** action; nav highlights under **Manage Devices** for `/devices/detail/…`.

---

## Phase 9 — Compare / impact engine

- `schema_diff_engine`
- Static graph impact, field diff, affected workflows, affected dashboards.
- **Per-widget binding review:** attribute / metric paths extracted from dashboard widget `binding` + `config` for widgets that reference this device’s **`data_object`**, compared to the device **`fieldCatalog`** attribute ids; flags missing paths and surfaces a note when **`schema_version`** changes.

**Rules — locked:**

- **Baseline** = previous **active** `device_versions` row.
- Dashboard bindings align with **schema + attribute identity** concerns in [DEVICE_VERSIONING_SPEC.md](./DEVICE_VERSIONING_SPEC.md) §1 (implementation uses field catalog + widget config as available in layout JSON).
- **Impact v1** = static graph + widget-level catalog gap (not live payload diff per widget).

**Status:** Implemented — service **`device_version_impact_service`**: **`GET …/device-versions`**, **`GET …/device-versions/{version_id}/impact`** returns `field_diff`, `workflows`, `dashboards`, **`catalog_attribute_ids`**, **`widget_attribute_impact`**, and `notes` (including schema drift + catalog-gap summaries).

---

## Phase 10 — Replay simulation

- Historical baseline data → **MVP:** sample **`scrubbed_events`** for the device’s resolved identity in a time window; structural compare vs reference sample; KPI numeric delta oldest/newest; static workflow/dashboard impact from **`build_static_impact_payload`**; text **recommendation**.

**Outputs (MVP):** `simulation_jobs` row with window, sample cap, records tested/passed/failed, `result_json` (field diff, KPI delta, workflow/dashboard impact lists, recommendation).

**API:** `POST /api/v1/simulations/replay`, `GET /api/v1/simulations/{job_id}` (permission **`simulation.run`**).

**Rule — locked:** **Replay is authoritative** for this MVP scope; full scrubber/workflow **re-execution** remains post–v8.

**Status:** MVP implemented — migration **`0045`** (`simulation_jobs`); service **`replay_simulation_service`**; audit **`replay_simulation_completed`** (Phase 13). **Post–v8:** candidate pipeline re-run, richer diffing.

---

## Phase 11 — OTA campaign UI

**Screens (target):** Firmware Library, Create Campaign Wizard, Campaign List, Campaign Detail, Target Status Table, Rollout Timeline, Logs/Events.

**Ideal wizard:** package → targets → compatibility → simulation → rollout plan → review & launch.

**Status:** **v1 + v8 polish shipped** — **API:** unchanged from v1 (`ota_campaign_service`, `/ota/campaigns/…`). **UI:** `/devices/ota` (list, **`ota.read`** / **`ota.create`** gates), **`/devices/ota/new`** multi-step wizard (**Plan → Targets → optional replay → Review**; permissions resolved for **selected site**), **`/devices/ota/{id}`** with **rollout milestone strip**, summary cards, targets, lifecycle gated to **`ota.create`**, **`ota.approve`**, **`ota.launch`** (pause/resume/launch/status hook), **cancel** requires **`ota.launch` or `ota.rollback`**, event log, **`POST /ota/status`** test hook (**`ota.launch`**). **Control-plane audit** on create/submit/approve/launch/cancel (Phase 13).

**Post–v8 / deferred:** dedicated **Firmware Library** screen and artifacts; **chart-grade** rollout timeline; wizard **compatibility** step as its own screen (today: device **impact** + simulation elsewhere).

---

## Phase 12 — RBAC for OTA / versioning

Permissions (string keys — **`permission_catalog`** + DB seeds; align migrations **`0043`**, **`0044`**, **`0046`**, **`0047`**):

- `ota.read`, `ota.create`, `ota.approve`, `ota.launch`, `ota.rollback`
- `device_versions.read`, `device_versions.promote`, `device_versions.isolate`, `device_versions.rollback`, **`device_versions.deprecate`**
- `simulation.run`
- **`lineage.read`**, **`audit.read`**
- (Existing platform/device/dashboard/workflow keys unchanged.)

**Status:** Foundation complete — keys seeded and role-granted; **`GET …/version-lineage`** accepts **`lineage.read` OR `devices.footprint.read`**; UI uses effective site permissions (including **`useSitePermissionKeys`** for device/campaign site). **Post–v8:** audit grant patterns for operators, stricter “every action” matrix.

---

## Phase 13 — Audit hardening

**Locked separation:**

- **Lineage** = what happened on the **device / data path** (immutable narrative for operators and systems).
- **Audit** = **who** did **what** in the control plane (campaign created, approved, launched, promote, rollback, deprecate, manual override, replay job completion, …).

**Implementation (MVP):**

- Table **`control_plane_audit_events`** (migration **`0045`**).
- **`emit_control_plane_audit`** service; **`GET /api/v1/audit/events`** (`audit.read`, optional `site_id` filter).
- **UI:** Administration → **Control plane audit** (`/administration/audit`).
- Emitters wired for OTA campaign lifecycle, device version lifecycle, replay simulation completion, explicit **`manual_override`** on device PATCH when version fields change.

**Post–v8:** richer payloads, correlation ids, streaming export, SIEM hooks, full action inventory.

---

## Document control

| Version | Date | Note |
|--------|------|------|
| 1.0 (locked) | 2026-05-07 | Phases 0–13 and sequencing rule agreed for implementation backlog. |
| 1.1 | 2026-05-07 | **Phases 1–3 shipped in API:** migration `0041` (`device_versions` + lineage columns), bootstrap `flush` + caller `commit`, lineage rows link `target_device_version_id`, transitions insert new `device_versions` rows. |
| 1.2 | 2026-05-06 | **Phases 4–7 shipped in API/worker:** `0042` OTA tables + candidate stores + `routing_lane`; `0043` RBAC seed for `device_versions.*` / `simulation.run` / `device_operator` + `ota.launch`; `POST /ota/status`; device-version lifecycle POSTs; candidate `latest_device_state` write path in worker. |
| 1.3 | 2026-05-06 | **Phases 8–9 shipped:** Device Details UI route + tabs; **`GET …/device-versions`**, **`GET …/device-versions/{id}/impact`**, **`GET …/ota-target-history`**; static impact v1 + schema drift note. |
| 1.4 | 2026-05-06 | **Phase 11 (OTA campaign control plane + UI v1):** campaign CRUD/lifecycle APIs, events stream, operator RBAC migration **`0044`**, frontend OTA hub under `/devices/ota`. |
| **1.5** | **2026-05-06** | **Version 8 closure:** Added delivery snapshot table; Phase **6** deprecate + audit; Phase **8** simulation tab; Phase **9** per-widget catalog impact; Phase **10** MVP + APIs; Phase **11** wizard/timeline polish + deferred list; Phases **12–13** foundation + audit UI; Phase **0** stub superseded; doc aligned with [ROADMAP.md](./ROADMAP.md). |

When a phase ships, update **ROADMAP.md** “Delivered” vs “Still open” and reference this file for full phase text.
