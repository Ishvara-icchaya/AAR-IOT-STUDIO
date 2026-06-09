# AAR IoT Studio — Consolidated Requirements (v1–v8+)

**Status:** Living requirements baseline  
**Audience:** Product, engineering, QA, operators  
**Scope:** Platform versions **v1 through v8**, **post–v8** governance, and **evolving** **Dashboard** and **Enterprise AI** capability tracks  
**Customer sign-off:** [CUSTOMER_APPROVAL_PACKAGE.md](./CUSTOMER_APPROVAL_PACKAGE.md) — which docs require approval and how to review them  

**Companion docs (normative detail):**

| Topic | Document |
|-------|----------|
| Phase 1 platform blueprint | [ENTERPRISE_FEATURES_EXPORT_UPDATED.md](./ENTERPRISE_FEATURES_EXPORT_UPDATED.md) |
| Device versioning locks | [DEVICE_VERSIONING_SPEC.md](./DEVICE_VERSIONING_SPEC.md) |
| Version governance architecture | [DEVICE_VERSION_GOVERNANCE_DESIGN.md](./DEVICE_VERSION_GOVERNANCE_DESIGN.md) |
| Endpoint version detection | [ENDPOINT_VERSION_IDENTITY.md](./ENDPOINT_VERSION_IDENTITY.md) |
| Dashboard widget runtime | [DASHBOARD_WIDGET_CONTRACT.md](./DASHBOARD_WIDGET_CONTRACT.md) |
| Enterprise AI field catalog | [SEMANTIC_FIELD_CATALOG_ENTERPRISE_AI.md](./SEMANTIC_FIELD_CATALOG_ENTERPRISE_AI.md) |
| Delivery backlog | [ROADMAP.md](./ROADMAP.md) |

---

## 1. How to read this document

### 1.1 Version numbering

**v1–v8** are **product capability generations** for AAR IoT Studio (incremental delivery on one codebase), not separate products.

| Label | Meaning |
|-------|---------|
| **SHALL / MUST** | Normative requirement |
| **SHOULD** | Strong expectation; may defer with documented rationale |
| **MAY** | Optional |
| **Delivered** | In mainline for typical deployments (verify in your environment) |
| **In progress** | Partially landed or active branch work |
| **Open** | Specified but not complete |

**Note:** [ENTERPRISE_FEATURES_EXPORT_UPDATED.md](./ENTERPRISE_FEATURES_EXPORT_UPDATED.md) uses **Phase 1 / 2 / 3** for **deployment** scope (on-prem vs license/SSO/cloud vs Ray). Those phases **overlap** v1–v3 but are not identical to v1–v8.

### 1.2 Global product objectives (all versions)

The platform **SHALL**:

1. Ingest device telemetry over approved transports and **always** archive raw payloads (MinIO + metadata) before transformation.
2. Transform raw data through **published** scrubber definitions into scrubbed/read models usable by workflows, dashboards, maps, and AI.
3. Enforce **tenant scope** (`customer_id`, site access) on APIs and runtime reads.
4. Preserve **referential integrity** — no unsafe deletes when downstream objects exist (see §3.1).
5. Expose **operational truth** via `latest_device_state`, trends, health, and alerts without requiring operators to query internal tables.
6. Support **on-prem Docker** deployment (Kafka **KRaft**, workers, Postgres, TimescaleDB, Redis, MinIO) with optional LLM disabled.

---

## 2. Version summary matrix

| Version | Theme | Primary outcomes | Representative migrations / artifacts |
|---------|--------|------------------|--------------------------------------|
| **v1** | Platform foundation | Core metadata, ingest, scrubber, workflow, dashboard shell, alerts, publish, AI stub | `0001`–`0011`, ENTERPRISE Phase 1 |
| **v2** | Endpoint-first read model | `endpoints`, `resolved_devices`, `scrubbed_events`, `latest_device_state`, identity publish, canonical ingest | `0028`–`0031`, CANONICAL_* ingest docs |
| **v3** | Operations, RBAC, fleet metadata | Site/tenant RBAC, liveness, health thresholds, trend allowlist, device readiness metadata | `0032`–`0037`, `0033` device versioning metadata |
| **v4** | Dashboard cohort runtime | Endpoint-group default binding, resolved-device-collection APIs, v2 binding policy | Endpoint-group steps, widget contract start |
| **v5** | Trends & map popups | Redis 5m rollups, trend window API, Timescale buckets, map popup trends | `alembic_ts` ts0003, `0032`, TREND_MAP phases 1–5 |
| **v6** | Map intelligence & scrubber depth | Expanded map intelligence, path/history, decode_series, operations overview | EXPANDED_MAP_INTELLIGENCE, SCRUBBER_DECODE_SERIES |
| **v7** | Dashboard UX evolution | Runtime shell, preview/live separation, map widget hardening, resolve-batch contract | DASHBOARD_WIDGET_CONTRACT, runtime CSS |
| **v8** | Device version governance | Immutable versions, lineage, impact, simulation, audit, Device Details hub | `0040`–`0047`, DEVICE_VERSIONING_SPEC |
| **Post–v8** | Governance pivot | Detection events, activation copy-forward, scrubber-managed identity; OTA app removed | `0052`–`0056`, ENDPOINT_VERSION_IDENTITY |

---

## 3. Requirements by version

### 3.1 v1 — Platform foundation (Delivered)

**Objective:** Ship a full **on-prem** IoT studio: ingest → scrub → workflow → dashboard / publish / alerts / AI entry points.

#### 3.1.1 Architecture & deployment

| ID | Requirement | Status |
|----|-------------|--------|
| V1-ARCH-01 | System **SHALL** use Kafka (**KRaft only**, no ZooKeeper), worker containers, Postgres, TimescaleDB, Redis, MinIO. | Delivered |
| V1-ARCH-02 | Phase 1 **SHALL NOT** depend on Ray; distributed compute is out of scope. | Delivered |
| V1-ARCH-03 | `customer_id` **SHALL** scope tenant resources even if deployment is single-tenant. | Delivered |

#### 3.1.2 Ingest & devices

| ID | Requirement | Status |
|----|-------------|--------|
| V1-ING-01 | Approved ingress **SHALL** converge on `raw_data_objects` + MinIO + Kafka `raw.ingest`. | Delivered |
| V1-DEV-01 | **Register Devices** **SHALL** capture name, description, site, icon. | Delivered |
| V1-DEV-02 | **Manage Devices** **SHALL** configure protocol, polling, attributes; **Save** starts ingestion. | Delivered |
| V1-DEV-03 | Raw data **SHALL** always be stored (no silent drop of archives). | Delivered |

#### 3.1.3 Scrubber

| ID | Requirement | Status |
|----|-------------|--------|
| V1-SCR-01 | Runtime source of truth **SHALL** be `device_objects.mapping.scrubberStudio` in Postgres. | Delivered |
| V1-SCR-02 | **Save Draft / Compile / Publish** semantics **SHALL** apply; only **published** pipelines run in workers. | Delivered |
| V1-SCR-03 | Published output **SHALL** be flat deterministic scalars (v1 pipeline contract). | Delivered |

#### 3.1.4 Workflow, dashboard, enterprise surfaces

| ID | Requirement | Status |
|----|-------------|--------|
| V1-WF-01 | Workflow Studio **SHALL** produce `result_object` terminators consumable by dashboard/publish. | Delivered |
| V1-DB-01 | Dashboard **SHALL** support configure → **freeze** → **live** three-page model. | Delivered |
| V1-DB-02 | Only **frozen** dashboards **SHALL** appear in Live view. | Delivered |
| V1-ED-01 | **Enterprise Dashboard** **SHALL** be per-user primary landing (primary embed + site health + alerts + KPI summary). | Delivered |
| V1-PS-01 | **Published Services** **SHALL** support start/stop publishing. | Delivered |
| V1-AL-01 | Unified **Alerts and Notifications** **SHALL** be available. | Delivered |

#### 3.1.5 Integrity & administration

| ID | Requirement | Status |
|----|-------------|--------|
| V1-RI-01 | Deletes **SHALL** be blocked when referential integrity rules apply (raw → data_object → workflow → dashboard, etc.). | Delivered |
| V1-ADM-01 | Navigation **SHALL** match ENTERPRISE §0.5 (Devices, Administration, Scrubber, Workflow, Dashboard, Enterprise Dashboard, Alerts, Enterprise AI, Published Services). | Delivered |
| V1-ADM-02 | **Restore to Default** **SHALL** require password + typed `RESET AAR-IOT-STUDIO`; full reset clears platform data state per ENTERPRISE §0.7. | Delivered |

#### 3.1.6 Enterprise AI (initial)

| ID | Requirement | Status |
|----|-------------|--------|
| V1-AI-01 | Enterprise AI **SHALL** support **structured** query mode without LLM. | Delivered |
| V1-AI-02 | Optional LLM **MAY** be enabled via Ollama; platform **SHALL** operate with LLM disabled. | Delivered |
| V1-AI-03 | AI sessions **MAY** use Redis `ai:session:{user_id}`. | Delivered |

---

### 3.2 v2 — Endpoint-first read model (Delivered)

**Objective:** Replace implicit device-only resolution with **durable endpoints**, **resolved devices**, and **`latest_device_state`** as the default operational read model; align scrubber and dashboard policy to v2.

| ID | Requirement | Status |
|----|-------------|--------|
| V2-EP-01 | System **SHALL** model `endpoints` with PK fields, labels, `object_name`, protocol, and lifecycle. | Delivered |
| V2-EP-02 | Workers **SHALL** produce `resolved_devices`, `scrubbed_events`, and `latest_device_state`. | Delivered |
| V2-ING-01 | Endpoint-bound ingest (MQTT, WebSocket, REST poller, authenticated REST push) **SHALL** use endpoint row as canonical device binding. | Delivered |
| V2-ING-02 | Unbound ingest (e.g. CoAP shared resource) **MAY** use payload resolution only when no endpoint context exists. | Delivered |
| V2-ING-03 | Ingest **SHALL** quarantine or reject paths that violate v2 binding policy (documented in CANONICAL_INGRESS). | Delivered |
| V2-ID-01 | Endpoint identity **SHALL** support draft → publish lifecycle with sample validation. | Delivered |
| V2-ID-02 | `v2_resolution` **SHALL** write v2 rows only when PK extraction succeeds. | Delivered |
| V2-SCR-01 | **Scrubber 2.0** UI/route **SHALL** exist for pipeline authoring (`/scrubber/v2/create`). | Delivered |
| V2-DB-01 | v2 dashboard validation/runtime **SHALL** reject `data_object` bindings (no silent fallback). | Delivered |
| V2-AI-01 | AI datasets **SHALL** align with v2 source policy (no legacy-only paths for new work). | Delivered |

---

### 3.3 v3 — Operations, RBAC, fleet metadata (Delivered)

**Objective:** Harden multi-user operations: permissions, liveness, health semantics, trend governance seeds, and device versioning **metadata** before immutable version rows (v8).

| ID | Requirement | Status |
|----|-------------|--------|
| V3-RBAC-01 | Site-scoped and tenant role RBAC **SHALL** gate API mutations and sensitive reads. | Delivered |
| V3-OPS-01 | Device liveness states and health threshold references **SHALL** drive operational KPIs. | Delivered |
| V3-TR-01 | Trend metric allowlist **SHALL** be configurable globally (`TREND_METRIC_ALLOWLIST`) and per site (`sites.trend_metric_allowlist`). | Delivered |
| V3-DV-01 | Devices **SHALL** store firmware/readiness metadata (`firmware_version`, `firmware_channel`, `ota_supported`, etc.) for Manage Devices. | Delivered |
| V3-IMP-01 | Device import **SHALL** be auditable. | Delivered |
| V3-AL-01 | Informational alert category **SHALL** be supported where configured. | Delivered |

---

### 3.4 v4 — Dashboard cohort & runtime APIs (Delivered)

**Objective:** Default dashboard bindings to **endpoint groups** (resolved device collections), not per-device `data_object` pointers.

| ID | Requirement | Status |
|----|-------------|--------|
| V4-DB-01 | **Endpoint Group** **SHALL** be the default widget binding mode; Individual Device **SHALL** be advanced. | Delivered |
| V4-DB-02 | `GET …/sources/resolved-device-collections` **SHALL** list cohort sources for builders. | Delivered |
| V4-DB-03 | `GET …/runtime/resolved-device-collection` **SHALL** return deterministic-ordered, cursor-paginated cohort rows + summary buckets. | Delivered |
| V4-DB-04 | Ordering **SHALL** be `updated_at DESC`, `scrubbed_event_id DESC`, `resolved_device_id ASC`. | Delivered |
| V4-DB-05 | Map widgets **SHALL** use `latest_device_state` sources only for endpoint-group maps (`require_location` where applicable). | Delivered |
| V4-DB-06 | Runtime **SHALL** auto-reflect cohort membership changes without manual dashboard edits. | Delivered |
| V4-DB-07 | Layout validation **SHALL** accept `resolved_device_collection` and enforce site/endpoint coherence. | Delivered |
| V4-DB-08 | Widget adapters **SHALL** support map, table, KPI, chart, device_tile, alert_summary for cohort bindings. | Delivered |

**Open (v4 → v7 bridge):** Full migration of all live/preview pages to **`resolve-batch`** only ([DASHBOARD_WIDGET_CONTRACT.md](./DASHBOARD_WIDGET_CONTRACT.md)).

---

### 3.5 v5 — Trends & map popups (Delivered)

**Objective:** Operational time windows on maps and dashboards via Redis rollups, optional Timescale durability, and popup trend UX.

| ID | Requirement | Status |
|----|-------------|--------|
| V5-TR-01 | Workers **SHALL** maintain 5m Redis buckets for `rdev`, `endpoint`, and `site` scopes with window keys 1h/24h. | Delivered |
| V5-TR-02 | `GET /api/v1/trends/window` **SHALL** read rollup windows with site auth aligned to map runtime. | Delivered |
| V5-TR-03 | Timescale **`trend_metric_bucket`** **SHOULD** be populated when `TIMESCALE_DATABASE_URL` is set. | Delivered |
| V5-TR-04 | Map detail **SHALL** expose `trend_context` for LDS markers; cluster popups **SHALL** support endpoint-scoped trends when cohort is homogeneous. | Delivered |
| V5-TR-05 | `maxPoints` downsampling (1–500) **SHALL** be available on trends window API. | Delivered |
| V5-TR-06 | Redis rebuild CLI **SHALL** exist for operational recovery. | Delivered |
| V5-MAP-01 | Map popups **SHALL** use React roots (not HTML string popups) for trend/detail UX. | Delivered |
| V5-MAP-02 | Map object Timescale trend mode **SHALL** be supported for non-LDS sources where configured. | Delivered |

**Open:** OpenAPI/field metadata catalog for trend metrics; fuller site rollup UX defaults.

---

### 3.6 v6 — Map intelligence & scrubber depth (Delivered / evolving)

**Objective:** Fleet map intelligence beyond point popups; richer scrubber transforms; field catalog for downstream AI.

| ID | Requirement | Status |
|----|-------------|--------|
| V6-MAP-01 | `GET …/map-runtime/intelligence/expanded` **SHALL** return roster, mobility, freshness, aggregates, `trend_context`. | Delivered |
| V6-MAP-02 | `GET …/map-runtime/intelligence/path` **SHALL** return polylines/gaps from `scrubbed_events`. | Delivered |
| V6-MAP-03 | Freshness rules **SHALL** be server-side (3× / 10× expected interval defaults; endpoint overrides allowed). | Delivered |
| V6-SCR-01 | Scrubber **`decode_series`** step **SHALL** implement v1 modes per SCRUBBER_DECODE_SERIES_SPEC. | Delivered |
| V6-SCR-02 | Deferred decode modes (protobuf, gzip, object_array, etc.) **SHALL NOT** block v1 delivery. | Open |
| V6-AI-01 | `device_objects.mapping.fieldCatalog` **SHALL** be versioned and validated on PATCH. | Delivered |
| V6-AI-02 | Worker scrubber **SHALL** populate `data_objects.ai_projection` on materialization. | Delivered |

**Open:** Animated playback timeline UI; dense path decimation; cluster ↔ intelligence panel wiring.

---

### 3.7 v7 — Dashboard UX & runtime contract (Delivered / evolving)

**Objective:** Grafana-style operational dashboard experience, strict widget data contracts, and separation of builder preview from live fit-page layout.

| ID | Requirement | Status |
|----|-------------|--------|
| V7-DB-01 | Dashboard runtime **SHALL** use shared visual layer (`.dashboard-runtime`) for live, builder preview, and enterprise modes. | Delivered |
| V7-DB-02 | Builder preview **SHALL NOT** share live-only fit-page compression rules (`layoutDensity=preview`). | Delivered |
| V7-DB-03 | Map widgets **SHALL** enforce minimum usable height (~320px) and aspect ratio in grid cells. | Delivered |
| V7-DB-04 | Live screenshot export **SHALL** handle oklab/MapLibre constraints safely. | Delivered |
| V7-DB-05 | `GET …/runtime-layout` **SHALL** return layout/metadata without embedded widget data. | Delivered |
| V7-DB-06 | `POST …/runtime/widgets/resolve-batch` **SHALL** be the canonical widget data path; camelCase `DashboardWidgetPayload` envelope. | Delivered |
| V7-DB-07 | Preview and live **SHALL** share RBAC and resolver; preview **SHALL** support unsaved `dashboardLayoutDraft`. | Delivered |
| V7-DB-08 | Sentinels `invalid_widget_reference` and `unsupported` **SHALL** be used instead of ad hoc `"unknown"`. | Delivered |
| V7-DB-09 | Table pagination cursors **SHALL** be opaque (server-owned). | Delivered |
| V7-DB-10 | KPI delta **SHALL** be computed server-side only. | Delivered |

**Note:** A parallel **Dashboard 2.0** scaffold (react-grid-layout) was explored and **removed** from the tree; v7 requirements **continue** on the main `/dashboard/*` surfaces and widget contract.

**Open:**

| ID | Requirement | Status |
|----|-------------|--------|
| V7-DB-11 | All canvas widgets **SHALL** load data only via `resolve-batch` (no parallel live embed resolver). | Open |
| V7-DB-12 | Configure-widget **diagnostics** panel **SHALL** surface binding/preview failures (cohort empty, identity publish hints). | Open |
| V7-DB-13 | Dedicated widget builders per type under registry pattern **SHOULD** fully replace legacy branches. | Open |

---

### 3.8 v8 — Device version governance (Delivered)

**Objective:** Immutable device versions, lineage, safe promotion, impact analysis, and audit—without mandatory historical data rewrite.

| ID | Requirement | Status |
|----|-------------|--------|
| V8-DV-01 | `device_versions` rows **SHALL** be immutable for contract-defining fields; status transitions on same row. | Delivered |
| V8-DV-02 | `device_version_lineage` **SHALL** record triggers, supersession, freeze, promote, and explicit cuts. | Delivered |
| V8-DV-03 | Version creation **SHALL** follow closed triggers: ingest shape, explicit create, external rollout (DEVICE_VERSIONING_SPEC §13). | Delivered |
| V8-DV-04 | Superseded scrubber/endpoint/workflow/dashboard **SHALL** become Frozen-Inoperable; only scrubber definition copies forward. | Delivered |
| V8-DV-05 | Dashboards **SHALL** resolve `attribute_id` first, path second. | Delivered |
| V8-DV-06 | Breaking versions **SHALL NOT** enter shared pipeline without explicit promote. | Delivered |
| V8-DV-07 | `POST /device-versions/{id}/promote`, `/isolate`, `/rollback` **SHALL** exist with RBAC and lineage side effects. | Delivered |
| V8-DV-08 | Device registration (v8) **SHALL** remain metadata-only; readiness field edits **SHALL NOT** auto-mint versions. | Delivered |
| V8-DV-09 | `GET /devices/{id}/footprint` **SHALL** include workflows and dashboards with site/version context. | Delivered |
| V8-DV-10 | `GET …/device-versions/{id}/impact` **SHALL** provide static blast radius (workflows, dashboards, field catalog diff). | Delivered |
| V8-DV-11 | `POST /simulations/replay` + `simulation_jobs` **SHALL** provide replay simulation MVP. | Delivered |
| V8-DV-12 | `control_plane_audit_events` + `GET /audit/events` **SHALL** support audit read path. | Delivered |
| V8-DV-13 | Device Details hub **SHALL** expose Overview, Versions, Lineage, Simulation. | Delivered |
| V8-DV-14 | KPI compare **SHALL** support paired versions with `compareA` / `compareB` deep links. | Delivered |
| V8-DV-15 | No mandatory bulk migration of historical raw/scrubbed/dashboard data (layer-on model). | Delivered |

**Open (post–v8):** Full scrubber/workflow re-execution in simulation; firmware artifact library; dashboard candidate-lane reads.

---

### 3.9 Post–v8 — Governance pivot (In progress)

**Objective:** Detect version drift from raw traffic; govern through evidence and explicit activation; retire in-app OTA campaign executor.

| ID | Requirement | Status |
|----|-------------|--------|
| P8-GOV-01 | Endpoint `version_identity` config **SHALL** own JSONPath mappings and fingerprint rules. | In progress |
| P8-GOV-02 | Worker **SHALL** detect on raw JSON before scrubber; Redis compare; Kafka on change only. | In progress |
| P8-GOV-03 | Hot path **SHALL NOT** synchronously mutate `device_versions` or lineage (async consumer). | In progress |
| P8-GOV-04 | `version_detection_events` **SHALL** be append-only evidence. | In progress |
| P8-GOV-05 | Lifecycle **SHALL** be `detected → draft → active → deprecated` with copy-forward activation artifacts. | In progress |
| P8-GOV-06 | UI **SHALL** label production promotion **Activate Version**. | In progress |
| P8-GOV-07 | `system_json.version_identity` **SHALL** carry runtime flags on LDS (not `identity_json`). | In progress |
| P8-GOV-08 | `identity_managed_by_scrubber` **SHALL** allow scrubber semantics to drive endpoint PK/labels. | In progress |
| P8-GOV-09 | Ingest **SHALL** be blocked for terminal version statuses (`deprecated`, `rolled_back`) per policy. | In progress |
| P8-GOV-10 | In-app OTA campaign REST/UI **SHALL** remain removed; external rollout + detection govern versions. | Delivered (removal) |

---

## 4. Dashboard — evolving functionality

Dashboard requirements **span v1–v7** and continue post–v8. This section is the **product line** view (not a single release).

### 4.1 Core principles (stable)

| ID | Requirement |
|----|-------------|
| DASH-CORE-01 | **Frozen** definition drives **Live**; draft edits do not affect live until saved and frozen. |
| DASH-CORE-02 | Widget data on canvas **SHALL** come from backend-shaped payloads, not client-side inference from raw tables. |
| DASH-CORE-03 | **Endpoint group** (resolved device collection) **SHALL** remain the default binding; `data_object` **SHALL** remain unsupported for new v2 runtime work. |
| DASH-CORE-04 | Preview and live **SHALL** share resolver, RBAC, and widget frame semantics. |
| DASH-CORE-05 | Layout engine owns cell geometry; widget frame owns chrome; renderer owns body only. |

### 4.2 Binding & data sources (v2 → v4 → v7)

| Source type | Use | Status |
|-------------|-----|--------|
| `resolved_device_collection` | KPI, table, chart, map, tiles, alerts for endpoint cohort | Delivered |
| `latest_device_state` / map runtime | Markers, popups, intelligence | Delivered |
| `data_object` / `result_object` | Legacy individual bindings | Legacy read only; **MUST NOT** be used for new v2 layouts |
| Version-aware reads (post–v8) | Default to **active** `device_version` for operational widgets | In progress |

### 4.3 Widget types & contracts (evolving)

| Widget family | Requirement | Status |
|---------------|-------------|--------|
| **Map / location_heading_map** | LDS markers, heading, health colors, popups, trends, cluster behavior, min 320px height | Delivered |
| **Endpoint collection KPI/table/chart/summary** | Cohort summary + rows; opaque pagination | Delivered |
| **Ops widgets** (`ops_*`) | Reuse shared builders; no duplicate ops code paths | Evolving |
| **Trend widgets** | Shared `dashboard_trend_service`; rollup preferred, bounded scrubbed_events fallback | Evolving |
| **Invalid/unsupported** | Sentinel types + clear `message` in envelope | Delivered |

### 4.4 Map & trends integration (v5 → v6 → v7)

| ID | Requirement | Status |
|----|-------------|--------|
| DASH-MAP-01 | Marker popups **SHALL** offer 1h/24h trends via `GET /trends/window` where `trend_context` applies. | Delivered |
| DASH-MAP-02 | Map detail **SHALL** pass `trendScope` (`resolved_device` \| `endpoint` \| `site`) and widget `kpiKeys`. | Delivered |
| DASH-MAP-03 | Expanded intelligence panel **SHOULD** integrate with dashboard map widget (runtime/historical toggle, path overlay). | Delivered |
| DASH-MAP-04 | Widget-level `map_default_trend_scope` **SHOULD** set default scope for single-marker popups. | Delivered |

### 4.5 Version governance interaction (v8+)

| ID | Requirement | Status |
|----|-------------|--------|
| DASH-VER-01 | Impact analysis **SHALL** enumerate dashboard widget refs vs device field catalog (`attribute_id` / path). | Delivered |
| DASH-VER-02 | Static impact **SHOULD** be run before promoting device versions that change schema bindings. | Delivered |
| DASH-VER-03 | Optional read path against `candidate_latest_device_state` **MAY** be added for staged cuts (RBAC-gated). | Open |
| DASH-VER-04 | Live widgets **SHALL** default to **active** version semantics when version-aware resolution is enabled. | In progress |

### 4.6 Dashboard backlog (consolidated)

1. Complete **`resolve-batch`** adoption on all live/preview routes.  
2. Configure-widget **diagnostics** for empty cohort / identity / `object_name` mismatches.  
3. OpenAPI + TS types for all widget `data` shapes.  
4. Candidate-lane live preview for OTA/staging scenarios.  
5. Retire legacy `data_object` dashboards via tenant migration (coordinated, not blind delete).

---

## 5. Enterprise AI — evolving functionality

Enterprise AI is an **evolving product line** from v1 (query UI + optional LLM) through v6 (field catalog + projections) with a defined end state in SEMANTIC_FIELD_CATALOG_ENTERPRISE_AI.

### 5.1 Core principles (stable)

| ID | Requirement |
|----|-------------|
| AI-CORE-01 | **Structured mode** **SHALL** work without LLM (rules/catalog/views). |
| AI-CORE-02 | **LLM mode** **MAY** summarize/explain only on **grounded evidence** JSON. |
| AI-CORE-03 | AI **SHALL NOT** parse full raw/scrubbed payloads per chat message at scale. |
| AI-CORE-04 | Field visibility **SHALL** use role-based catalog + `ai_exposed` flag (defense in depth). |
| AI-CORE-05 | KPI pipeline **SHALL** remain metrics-only; identity/display **SHALL NOT** be smuggled via KPI keys long term. |

### 5.2 Modes (v1 → present)

| Mode | Behavior | Status |
|------|----------|--------|
| **Structured** | Safe queries against curated views / catalog projections | Delivered |
| **LLM-assisted** | Intent, summarization, reports when Ollama configured | Delivered |
| **Evidence-first** | Role-bucket JSON contract before optional LLM | Evolving |

### 5.3 Semantic field catalog (v6+ target)

| ID | Requirement | Status |
|----|-------------|--------|
| AI-CAT-01 | Catalog **SHALL** live on scrubber/device object definition (`fieldCatalog`, versioned). | Delivered |
| AI-CAT-02 | Roles **SHALL** include: `metric`, `identity`, `health`, `geo`, `grouping`, `display`, `filter`, `timestamp`. | Delivered |
| AI-CAT-03 | Publish-time validation **SHALL** enforce timestamp presence, metric types, `ai_exposed` label rules. | Evolving |
| AI-CAT-04 | `ai_projection` on `data_objects` **SHALL** be rebuilt when catalog or payload changes. | Delivered |
| AI-CAT-05 | Enterprise AI retrieval **SHALL** use projections + catalog versions, not ad hoc KPI substring heuristics. | Evolving |

### 5.4 Evidence contract (target)

Evidence JSON **SHALL**:

- Include `object_type`, `catalog_version`, `asof_ts`.  
- Project only `ai_exposed` fields into role buckets (`identity`, `metrics`, `health`, `geo`, etc.).  
- Omit or empty unused buckets consistently (documented convention).  
- Never include undeclared paths or raw table dumps.

### 5.5 Retrieval pipeline (end state)

1. Resolve object types + site/time scope (policy-bound).  
2. Load latest objects + materialized `ai_projection`.  
3. Load field catalog for definition version.  
4. Assemble evidence array + metadata (counts, clamp flags).  
5. Optional grounded LLM on evidence only.

### 5.6 Enterprise AI backlog (consolidated)

| Item | Priority |
|------|----------|
| Rich catalog editor in Scrubber Studio UI | High |
| Complete migration off intent/substring heuristics (SEMANTIC_FIELD_CATALOG §10) | High |
| Full publish-time validation matrix (geo pairs, duplicate timestamps) | Medium |
| Stable OpenAPI for evidence + chat responses | Medium |
| Session/context limits and audit for AI queries | Medium |
| Multi-object cross-site questions with policy clamps | Lower |

### 5.7 Cross-links to version governance

| ID | Requirement | Status |
|----|-------------|--------|
| AI-GOV-01 | Scrubber/catalog version changes **SHALL** trigger new `device_version` when ingest-shape rules apply. | Delivered |
| AI-GOV-02 | AI answers for “live” questions **SHOULD** respect **active** device version semantics when version-aware reads land. | Open |

---

## 6. Cross-cutting non-functional requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-SEC-01 | Security | All tenant APIs **SHALL** authenticate and enforce site/customer scope. |
| NFR-SEC-02 | Security | Ingest hardening follow-ups documented in SECURITY_INGEST_HARDENING **SHOULD** be applied for production exposure. |
| NFR-PERF-01 | Performance | Hot ingest path **SHALL NOT** block on async governance or AI writes. |
| NFR-PERF-02 | Performance | Trend/map rollups **SHOULD** prefer Redis with Timescale durability optional. |
| NFR-UX-01 | UX | Main shells **SHOULD** minimize spurious scrollbars; use flex/grid and density (ENTERPRISE §0.6). |
| NFR-UX-02 | UX | Typography **SHALL** use tokenized font stack (Aptos preferred when licensed). |
| NFR-OPS-01 | Operations | Workers **SHALL** be containerized in Compose; heartbeats for idle scaffolds acceptable until real workloads land. |
| NFR-TEST-01 | Quality | Acceptance tests **SHOULD** exist for endpoint-group dashboards, trends window, version lifecycle, and scrubber decode_series. |
| NFR-DOC-01 | Documentation | Normative contracts **SHALL** be updated when behavior locks change. |

---

## 7. Traceability index

| Requirement area | Primary spec |
|------------------|--------------|
| Ingest / MQTT / REST | CANONICAL_INGRESS_PRODUCT, CANONICAL_RAW_INGEST, ARCHITECTURE_MQTT_INGEST |
| Device identity | CANONICAL_DEVICE_IDENTITY_INGEST |
| Manage Devices UI | MANAGE_DEVICES_AND_INGEST_PIPELINES |
| Scrubber pipeline | ENTERPRISE §0.4, SCRUBBER_DECODE_SERIES_SPEC |
| Dashboard runtime | DASHBOARD_WIDGET_CONTRACT, DASHBOARD_MAP_TILES |
| Map trends | MAP_POPUP_TREND_WINDOWS_CONTRACT, TREND_MAP_PHASES_README |
| Map intelligence | EXPANDED_MAP_INTELLIGENCE |
| Device versions | DEVICE_VERSIONING_SPEC, DEVICE_VERSION_GOVERNANCE_DESIGN |
| Version detection | ENDPOINT_VERSION_IDENTITY |
| Enterprise AI | SEMANTIC_FIELD_CATALOG_ENTERPRISE_AI |
| UI components | FRONTEND_DESIGN_COMPONENTS |
| Iteration history | ITERATION_LOG |

---

## 8. Document maintenance

- Update **§2 matrix** and version sections when a milestone closes.  
- Add requirement IDs when introducing new MUST-level behavior.  
- Keep **Dashboard** (§4) and **Enterprise AI** (§5) as the home for **evolving** acceptance criteria even when work ships between numbered versions.  
- Prepend delivery notes to [ITERATION_LOG.md](./ITERATION_LOG.md) for session-level detail; link major milestones here.

---

## 9. One-line product definition

**AAR IoT Studio** is an on-prem IoT operations platform that ingests and archives device data, transforms it through versioned scrubber contracts into live and historical read models, visualizes fleet health through evolving dashboards and maps, explains telemetry through catalog-grounded Enterprise AI, and governs firmware and schema change through immutable device versions—from first endpoint binding (v2) through explicit activation of production wiring (v8+).
