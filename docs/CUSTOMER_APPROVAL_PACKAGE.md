# Customer Approval Package — AAR IoT Studio Documentation

**Purpose:** This writeup describes **which project documents seek customer approval**, what each one commits the platform to, and how to review them efficiently. It is the **cover document** for a formal sign-off cycle—not a substitute for the underlying specs.

**Audience:** Customer product owners, operations leadership, security/compliance reviewers, and program sponsors.  
**Prepared for:** Approval of **locked product and engineering contracts** that govern ingest, device identity, versioning, dashboards, maps/trends, scrubber behavior, and Enterprise AI direction.

---

## 1. Executive summary

AAR IoT Studio is documented in **26 markdown files** under `docs/`. Of these, **sixteen** are intended for **customer review and approval** (binding or product-facing). The remainder are **internal engineering trackers**, runbooks, or explanatory guides that **do not require sign-off** but may be shared for transparency.

By approving this package, the customer is **not** approving every line of code or every backlog item. The customer **is** approving:

1. **How data enters the platform** (approved ingress modes and immutable raw-ingest contracts).  
2. **How devices are identified and versioned** (endpoint binding, detection, governance lifecycle, and operator workflows such as **Activate Version**).  
3. **How operators see fleet health** (dashboard binding model, map/trend behavior, widget data contracts).  
4. **How telemetry becomes trustworthy for AI** (semantic field catalog and evidence-based Enterprise AI).  
5. **The overall product scope and navigation** for the on-prem Phase 1 platform (enterprise baseline).

**Consolidated view:** [CONSOLIDATED_REQUIREMENTS.md](./CONSOLIDATED_REQUIREMENTS.md) rolls up requirements **v1–v8+** including evolving Dashboard and Enterprise AI tracks. Use it as the **master checklist**; use tiered docs below for **detail and locks**.

---

## 2. Recommended approval workflow

| Step | Action |
|------|--------|
| 1 | Read this package (§3–§6). |
| 2 | Review **Tier A** documents—these contain **SHALL / MUST** language and **locked** contracts. |
| 3 | Review **Tier B** for product intent, UX labels, and governance flows (may approve “direction” while deferring backlog items). |
| 4 | Note **Tier C** informational docs; no signature required unless your process requires it. |
| 5 | Complete the **Approval checklist** (§8) and record exceptions in writing. |
| 6 | Engineering implements against approved docs; changes to **locked** sections require a **contract revision** and re-approval. |

**Suggested sign-off roles:**

| Role | Focus |
|------|--------|
| **Product owner** | Tier A ingress + device/version governance + dashboard binding defaults |
| **Operations / fleet** | Manage Devices flows, map/trends, Activate Version UX |
| **Security / IT** | Ingress hardening acknowledgements, map tile egress, restore-to-default |
| **Analytics / AI sponsor** | Semantic field catalog and Enterprise AI evidence model |

---

## 3. Tier A — Binding contracts (customer approval required)

These documents use **normative**, **locked**, or **MUST conform** language. Implementation is expected to match them; deviations require a documented change request and customer re-approval.

### 3.1 Platform baseline

| Document | What you are approving | Customer-visible impact |
|----------|------------------------|-------------------------|
| [ENTERPRISE_FEATURES_EXPORT_UPDATED.md](./ENTERPRISE_FEATURES_EXPORT_UPDATED.md) | **Phase 1 system blueprint:** stack (Kafka KRaft, workers, Postgres, Timescale, Redis, MinIO), **final navigation**, device/scrubber/workflow/dashboard/AI surfaces, referential integrity, **Restore to Default** (two-step destructive reset), scrubber Save/Compile/Publish, three-page dashboard model, Enterprise Dashboard as landing. | Defines **what the product is** on day one: menu structure, major routes, and non-negotiable platform rules (e.g. frozen dashboards for live view, raw always stored). |
| [CONSOLIDATED_REQUIREMENTS.md](./CONSOLIDATED_REQUIREMENTS.md) | **Requirements v1–v8+** with IDs, delivered/open status, plus **Dashboard** and **Enterprise AI** as evolving capability tracks. | Single **acceptance matrix** for program milestones and UAT scope. |

### 3.2 Ingest and device identity

| Document | What you are approving | Customer-visible impact |
|----------|------------------------|-------------------------|
| [CANONICAL_INGRESS_PRODUCT.md](./CANONICAL_INGRESS_PRODUCT.md) | **Approved ingress modes** (MQTT, REST push/pull, CoAP, WebSocket) and mandatory pipeline: archive → MinIO → Kafka → workers. REST/MQTT operational requirements (monitoring, alerts, ports). | No “shadow” ingest paths; all transports behave consistently for support and compliance. |
| [CANONICAL_RAW_INGEST.md](./CANONICAL_RAW_INGEST.md) | **Locked** raw SoT (Postgres + MinIO), frozen **`RawIngestEnvelopeV1`**, topic **`raw.ingest`**, verify/rehash semantics, lifecycle states. | Stable audit trail for raw payloads; envelope changes need explicit **schema_version** bump. |
| [CANONICAL_DEVICE_IDENTITY_INGEST.md](./CANONICAL_DEVICE_IDENTITY_INGEST.md) | **Endpoint-bound ingest** as default: saved `device_endpoints` row is canonical device binding; payload `device_id` fields are metadata only on bound paths. | Operators configure **endpoints**, not ad hoc payload IDs, for MQTT/WS/REST poller. |
| [ARCHITECTURE_MQTT_INGEST.md](./ARCHITECTURE_MQTT_INGEST.md) | MQTT **ingest** vs **published-services** separation; multi-broker connection grouping; subscription model tied to Manage Devices. | Predictable MQTT connectivity and support boundaries (ingest bridge ≠ outbound publish). |

### 3.3 Device versioning and governance

| Document | What you are approving | Customer-visible impact |
|----------|------------------------|-------------------------|
| [DEVICE_VERSIONING_SPEC.md](./DEVICE_VERSIONING_SPEC.md) | **Final spec closures:** immutable `device_versions`, dashboard binding (`attribute_id` first), scrubber drift rules, shared vs isolated pipeline, frozen-inoperable superseded artifacts, closed version-creation triggers, lineage + KPI compare, **v8 registration** carve-outs (readiness metadata does not auto-mint versions). | Fleet schema changes become **visible version cuts**; dashboards do not silently drift; operators must **explicitly** re-wire endpoint/dashboard after promotion. |
| [ENDPOINT_VERSION_IDENTITY.md](./ENDPOINT_VERSION_IDENTITY.md) | **Endpoint version identity detection** on **raw JSON** before scrubber; Redis fingerprints; async events; **`version_detection_events`**; lifecycle **`detected → draft → active → deprecated`**; UI label **Activate Version**; section **Governance lifecycle (approved locks)** marked **Approved for implementation**. | Devices can report firmware/config changes in traffic; production promotion remains **operator-controlled**, not automatic on ingest. |
| [DEVICE_VERSION_GOVERNANCE_DESIGN.md](./DEVICE_VERSION_GOVERNANCE_DESIGN.md) | **Design rationale** for post–v8 governance pivot (OTA campaign UI removed; detection + copy-forward + activation). Objectives, architecture diagram, success criteria. | Explains **why** the product moved from in-app OTA campaigns to **governance-first** versioning—aligns expectations with [ROADMAP.md](./ROADMAP.md). |

### 3.4 Dashboard, map, and trends

| Document | What you are approving | Customer-visible impact |
|----------|------------------------|-------------------------|
| [DASHBOARD_WIDGET_CONTRACT.md](./DASHBOARD_WIDGET_CONTRACT.md) | **Widget runtime contract:** `runtime-layout` + **`resolve-batch`** only on canvas; camelCase payloads; no `data_object` in v2; opaque pagination cursors; preview = live RBAC; sentinel error types. | Dashboard tiles show **consistent, server-prepared data**; legacy bindings fail with clear messages, not silent wrong charts. |
| [MAP_POPUP_TREND_WINDOWS_CONTRACT.md](./MAP_POPUP_TREND_WINDOWS_CONTRACT.md) | **Engineering-ready** map popup + **5m** Redis/Timescale trend windows (1h/24h), entity scopes (device/endpoint/site), React popup rules (v1.8). | Map click → trend context with governed metrics and formatting—not ad hoc client math. |
| [EXPANDED_MAP_INTELLIGENCE.md](./EXPANDED_MAP_INTELLIGENCE.md) | **Normative** expanded map intelligence APIs (roster, freshness, mobility, historical path from `scrubbed_events`). | Full-screen fleet intelligence view with server-side freshness rules. |
| [MAP_RICH_POINT_AND_SEMANTICS_CONTRACT.md](./MAP_RICH_POINT_AND_SEMANTICS_CONTRACT.md) | **Locked** map point transport vs semantic display ladder; no silent overwrite of saved labels. | Consistent map labels across live, historical, trace, and replay modes. |
| [DASHBOARD_MAP_TILES.md](./DASHBOARD_MAP_TILES.md) | **Production map tile policy:** style URL precedence, offline fallback, licensing note (demo tiles not production commitment). | On-prem/air-gap deployments must configure **customer-owned** tile endpoints. |

### 3.5 Scrubber and Enterprise AI

| Document | What you are approving | Customer-visible impact |
|----------|------------------------|-------------------------|
| [SCRUBBER_DECODE_SERIES_SPEC.md](./SCRUBBER_DECODE_SERIES_SPEC.md) | **Locked** generic `decode_series` step (v1 modes, validation, error codes, security limits); Base64 is a mode, not a separate primitive. | Binary/time-series payloads decoded **predictably** in scrubber pipelines. |
| [SEMANTIC_FIELD_CATALOG_ENTERPRISE_AI.md](./SEMANTIC_FIELD_CATALOG_ENTERPRISE_AI.md) | **Locked target** for field **roles** (`metric`, `identity`, `geo`, …), versioned **fieldCatalog**, materialized **`ai_projection`**, evidence JSON contract; KPI must not absorb identity fields long term. | Enterprise AI answers from **declared semantics**, not hidden heuristics; operators control what AI may see via `ai_exposed`. |

---

## 4. Tier B — Product alignment (approve direction; backlog may remain open)

These documents support customer understanding and UAT planning. They reference Tier A locks but may include **open** or **in progress** items.

| Document | Role in approval package |
|----------|---------------------------|
| [ROADMAP.md](./ROADMAP.md) | **Delivery status:** what is complete (v8 lineage, impact, simulation, audit) vs **still open** (simulation depth, firmware artifact library, decode_series deferred modes). Customer should **acknowledge** backlog, not approve every future line as committed scope. |
| [MANAGE_DEVICES_AND_INGEST_PIPELINES.md](./MANAGE_DEVICES_AND_INGEST_PIPELINES.md) | **Operator guide** to Register / Manage / Raw Data UI and how it maps to `device_endpoints` and the canonical pipeline. Validates Tier A ingest docs against day-to-day workflows. |
| [CANDIDATE_LANE_CONSUMERS.md](./CANDIDATE_LANE_CONSUMERS.md) | **Technical note** on optional candidate LDS reads (staging/OTA-era); governance v1 **does not** require candidate lane. Approve only if customer still wants **staging preview** on roadmap. |

---

## 5. Tier C — Informational (no approval required; share as needed)

| Document | Why it is outside sign-off |
|----------|----------------------------|
| [TREND_MAP_OPERATIONS.md](./TREND_MAP_OPERATIONS.md) | Operator/engineer **runbook** (CLI, env vars). |
| [TREND_MAP_PHASES_README.md](./TREND_MAP_PHASES_README.md) | Internal **phase tracker** for trend/map implementation. |
| [SCRUBBER_DATA_OBJECTS_VIEW.md](./SCRUBBER_DATA_OBJECTS_VIEW.md) | UI behavior explainer (Studio preview vs worker-written rows). |
| [SECURITY_INGEST_HARDENING.md](./SECURITY_INGEST_HARDENING.md) | Explicitly **non-normative** security follow-ups for production hardening. |
| [FRONTEND_DESIGN_COMPONENTS.md](./FRONTEND_DESIGN_COMPONENTS.md) | Internal design-system policy for developers. |
| [DESIGN_CLEANUP_CSS_TOKENS_TICKET.md](./DESIGN_CLEANUP_CSS_TOKENS_TICKET.md) | Internal engineering ticket. |
| [ITERATION_LOG.md](./ITERATION_LOG.md) | Append-only **development history** (crash recovery), not a contract. |

---

## 6. What the customer is deciding (decision summary)

Approving Tier A + Tier B direction commits the organization to the following **product truths**:

### 6.1 Ingest and data custody

- All approved transports land on the **same** archive + Kafka path.  
- Raw payloads remain **retrievable and verifiable** (MinIO + Postgres).  
- Endpoint configuration—not opportunistic payload IDs—defines which device receives data on standard transports.

### 6.2 Versioning and fleet change

- Device versions are **immutable snapshots**; operators **activate** production wiring explicitly.  
- Firmware/config **detection** from live traffic **does not** auto-promote dashboards or scrubbers.  
- Superseded bindings become **frozen** (auditable, not live).  
- In-app **OTA campaign orchestration** is **out of product scope**; external rollout + governance versioning applies.

### 6.3 Dashboards and maps

- Default dashboards bind to **endpoint groups** (cohorts), not legacy per-row `data_object` pointers.  
- Widget numbers come from the **server** (`resolve-batch`), not browser-side guessing.  
- Maps expose **trends and intelligence** under documented contracts; production maps need **customer-configured** tile URLs.

### 6.4 Enterprise AI

- AI uses a **field catalog** and **role-based evidence**; sensitive fields require explicit `ai_exposed`.  
- LLM is **optional**; structured mode must work without it.

### 6.5 Administration and safety

- **Restore to Default** is a **full deployment reset** with typed confirmation—destructive by design.  
- Referential integrity **blocks** unsafe deletes when downstream objects exist.

---

## 7. Known open items (disclose before sign-off)

Customer approval should **explicitly note** these items as **not yet locked** or **not in current scope**, unless the customer chooses to expand scope:

| Area | Open item | Primary reference |
|------|-----------|-------------------|
| Version governance | Full simulation re-execution (scrubber/workflow), firmware artifact library | [ROADMAP.md](./ROADMAP.md), [CONSOLIDATED_REQUIREMENTS.md](./CONSOLIDATED_REQUIREMENTS.md) §3.9 |
| Version governance | `candidate_lane` live dashboard reads | [CANDIDATE_LANE_CONSUMERS.md](./CANDIDATE_LANE_CONSUMERS.md) |
| Dashboard | 100% `resolve-batch` on all pages; configure-widget diagnostics | [DASHBOARD_WIDGET_CONTRACT.md](./DASHBOARD_WIDGET_CONTRACT.md), [CONSOLIDATED_REQUIREMENTS.md](./CONSOLIDATED_REQUIREMENTS.md) §4.6 |
| Enterprise AI | Catalog editor UI; full heuristic migration | [SEMANTIC_FIELD_CATALOG_ENTERPRISE_AI.md](./SEMANTIC_FIELD_CATALOG_ENTERPRISE_AI.md) §10 |
| Scrubber | `decode_series` deferred modes (protobuf, gzip, etc.) | [SCRUBBER_DECODE_SERIES_SPEC.md](./SCRUBBER_DECODE_SERIES_SPEC.md) |
| Security | CoAP hardening, additional ingest limits | [SECURITY_INGEST_HARDENING.md](./SECURITY_INGEST_HARDENING.md) |
| Typography | Aptos self-host pending corporate approval | [ENTERPRISE_FEATURES_EXPORT_UPDATED.md](./ENTERPRISE_FEATURES_EXPORT_UPDATED.md) §0.6 |

---

## 8. Customer approval checklist (template)

Copy this section into your change record or sign-off form.

```
Customer: _______________________     Date: ___________

[ ] Tier A — ENTERPRISE_FEATURES_EXPORT_UPDATED (Phase 1 baseline)
[ ] Tier A — CONSOLIDATED_REQUIREMENTS (v1–v8+ acceptance matrix)
[ ] Tier A — CANONICAL_INGRESS_PRODUCT + CANONICAL_RAW_INGEST + CANONICAL_DEVICE_IDENTITY_INGEST
[ ] Tier A — ARCHITECTURE_MQTT_INGEST
[ ] Tier A — DEVICE_VERSIONING_SPEC + ENDPOINT_VERSION_IDENTITY + DEVICE_VERSION_GOVERNANCE_DESIGN
[ ] Tier A — DASHBOARD_WIDGET_CONTRACT + MAP_POPUP_TREND_WINDOWS + EXPANDED_MAP_INTELLIGENCE
[ ] Tier A — MAP_RICH_POINT_AND_SEMANTICS_CONTRACT + DASHBOARD_MAP_TILES
[ ] Tier A — SCRUBBER_DECODE_SERIES_SPEC (v1 modes)
[ ] Tier A — SEMANTIC_FIELD_CATALOG_ENTERPRISE_AI (locked target)

[ ] Tier B — ROADMAP acknowledged (open items listed in §7 accepted as out of scope or scheduled)
[ ] Tier B — MANAGE_DEVICES_AND_INGEST_PIPELINES (operator workflows)

Exceptions / conditions:
_________________________________________________________________
_________________________________________________________________

Authorized signature: _______________________
```

---

## 9. Document dependency map

Understanding **read order** reduces review time:

```text
ENTERPRISE_FEATURES (baseline)
        │
        ├── CONSOLIDATED_REQUIREMENTS (v1–v8+ rollup)
        │
        ├── Ingest cluster
        │     CANONICAL_INGRESS_PRODUCT
        │     ├── CANONICAL_RAW_INGEST
        │     ├── CANONICAL_DEVICE_IDENTITY_INGEST
        │     └── ARCHITECTURE_MQTT_INGEST
        │
        ├── Version governance cluster
        │     DEVICE_VERSION_GOVERNANCE_DESIGN (why)
        │     ├── DEVICE_VERSIONING_SPEC (locks)
        │     └── ENDPOINT_VERSION_IDENTITY (detection + approved lifecycle)
        │
        ├── Dashboard / map cluster
        │     DASHBOARD_WIDGET_CONTRACT
        │     ├── MAP_POPUP_TREND_WINDOWS_CONTRACT
        │     ├── EXPANDED_MAP_INTELLIGENCE
        │     ├── MAP_RICH_POINT_AND_SEMANTICS_CONTRACT
        │     └── DASHBOARD_MAP_TILES
        │
        └── Scrubber / AI cluster
              SCRUBBER_DECODE_SERIES_SPEC
              └── SEMANTIC_FIELD_CATALOG_ENTERPRISE_AI
```

---

## 10. Relationship to implementation status

Many Tier A documents describe behavior that is **already delivered** in mainline (see [ROADMAP.md](./ROADMAP.md) and [CONSOLIDATED_REQUIREMENTS.md](./CONSOLIDATED_REQUIREMENTS.md)). Customer approval here means:

- **Acceptance** of specified behavior as the **contractual target** for the deployment, and  
- **Agreement** that future changes to **locked** sections follow change control.

Approval is **not** a statement that every optional backlog item is implemented in your environment—verify against your build and migrations (`0045`–`0056` for recent governance work).

---

## 11. Contact and change control

| Change type | Process |
|-------------|---------|
| Clarification only | Update doc; no re-approval if behavior unchanged |
| New **SHALL/MUST** or **locked** rule | Revise Tier A doc + customer re-approval |
| Backlog / deferred feature | Update ROADMAP + CONSOLIDATED_REQUIREMENTS; optional customer acknowledgment |

---

## 12. One-paragraph approval statement (for executive summary)

*The customer approves the AAR IoT Studio documentation package identified in **CUSTOMER_APPROVAL_PACKAGE.md**, thereby accepting the locked contracts for multi-protocol ingest and raw archive integrity, endpoint-first device identity, immutable device versioning with explicit **Activate Version** promotion, endpoint-group dashboard runtime, map trend and intelligence contracts, scrubber decode-series behavior, and catalog-grounded Enterprise AI—while acknowledging documented open backlog items in ROADMAP and CONSOLIDATED_REQUIREMENTS that are outside the current approval scope unless explicitly listed in the sign-off exceptions.*

---

*This package should be distributed with Tier A PDFs or links. Internal teams continue to use ITERATION_LOG and phase READMEs without customer sign-off.*
