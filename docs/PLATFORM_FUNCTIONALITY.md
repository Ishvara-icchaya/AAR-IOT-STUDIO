# AAR IoT Studio — Platform Functionality

## Purpose

AAR IoT Studio is an **on-premises industrial IoT operations platform**. It connects heterogeneous devices and protocols to a single operational model so teams can **ingest, understand, govern, visualize, and act on** telemetry without building custom pipelines for every site or every firmware generation.

The platform exists to solve a recurring enterprise problem: device data arrives in many shapes and changes often, while dashboards, workflows, and analytics must stay **trustworthy, auditable, and deliberate**. AAR IoT Studio makes change **visible and controlled** rather than silent—operators always know which contract is live, what changed, and what will break if they promote an update.

---

## Who it serves

| Stakeholder | Primary need | How the platform helps |
|-------------|--------------|-------------------------|
| **Operations / fleet** | See which assets are healthy, where they are, and whether data is current | Live fleet views, maps, trends, alerts, device liveness |
| **Integration / engineering** | Bind protocols, normalize payloads, publish scrubbed data | Device and endpoint configuration, scrubber pipelines, ingest monitoring |
| **Product / program** | Roll out firmware or schema changes without breaking production KPIs | Device versioning, impact preview, explicit activation |
| **Analytics / AI consumers** | Ask questions against curated semantics, not raw JSON | Field roles, governed AI evidence, optional LLM summarization |
| **IT / platform** | Deploy on-prem with clear data custody and reset boundaries | Docker-based stack, full deployment restore, tenant-scoped access |

---

## What the platform does (capability map)

### 1. Connect and ingest

The platform accepts telemetry from **approved transports**—typically MQTT, HTTP (push or pull), WebSocket, and listener-style protocols such as CoAP where deployed. Every accepted message follows the same custody model:

- The **original payload is archived** (durable object storage plus database metadata).
- A **streaming handoff** notifies workers to process the message.
- **No transport is allowed to skip** archival or metadata recording.

**Customer intent → platform action**

| Customer says… | Platform delivers… |
|----------------|-------------------|
| “We have MQTT from many brokers.” | Per-device endpoint profiles; connections grouped by broker credentials; subscriptions driven from device configuration. |
| “Upstream will POST JSON.” | Authenticated ingest API; payloads tied to the registered device the operator selected. |
| “We need to poll a legacy REST API.” | Scheduled poller workers using saved URL, auth, and interval on the device endpoint. |
| “We must prove what was received.” | Raw archive with verify/rehash; ingest status and error visibility in monitoring and alerts. |

**Design principle:** For standard configured transports, the **saved device endpoint** decides which logical device receives data—not opportunistic fields inside the JSON payload.

---

### 2. Identify devices and endpoints

Each logical **device** belongs to a **site** under a **customer** (tenant). Devices are configured with protocol settings, polling behavior, and validation state. **Endpoints** represent the ingest binding: how raw bytes map into the platform’s resolution and scrubbing pipeline.

Operators can **capture sample payloads**, define **primary-key and label paths**, and **publish** identity rules so the platform consistently resolves “which asset is this row?” across ingests.

**Customer intent → platform action**

| Customer says… | Platform delivers… |
|----------------|-------------------|
| “One gateway sends many asset IDs.” | Primary-key extraction and resolved-device records per distinct identity. |
| “We need human-readable names on maps.” | Label fields and semantic display rules on map points. |
| “Identity should follow our scrubber semantics.” | Optional path where published scrubber roles drive endpoint identity without duplicate mapping UIs. |

---

### 3. Transform data (scrubber)

**Scrubbers** turn raw payloads into **normalized, flat, deterministic** records suitable for KPIs, workflows, and dashboards. Authoring follows a clear lifecycle:

- **Draft** — experiment locally or in the UI without affecting production.
- **Compile** — validate structure and produce a runtime definition.
- **Publish** — only published definitions execute in workers.

Scrubber evolution is treated as **contract change**: pipeline edits, decode steps for binary or series payloads, and field catalogs are versioned with the device—not silently patched in place.

**Customer intent → platform action**

| Customer says… | Platform delivers… |
|----------------|-------------------|
| “Our payload is Base64 sensor blocks.” | Decode-series steps with explicit modes and limits—not one-off scripts. |
| “We need speed, fuel, and GPS in one object.” | Scalar extraction, transforms, and KPI-oriented outputs. |
| “AI should know what fields mean.” | Semantic field catalog (roles such as metric, identity, geo, timestamp) attached to the definition. |

---

### 4. Run workflows and publish

**Workflows** consume scrubbed data and produce **result objects** for automation, termination blocks, and downstream systems. **Published services** control outbound delivery (including MQTT publish paths separate from ingest). **Alerts** unify operational notifications with ingest and health categories.

Referential integrity prevents unsafe deletion: objects still referenced by workflows, dashboards, or active publishes must be **stopped or detached** first.

**Customer intent → platform action**

| Customer says… | Platform delivers… |
|----------------|-------------------|
| “When health goes critical, notify maintenance.” | Workflow graphs with alert and publish nodes. |
| “Send KPIs to an external broker.” | Published-services configuration distinct from ingest subscribers. |
| “Don’t let someone delete a device still on a dashboard.” | Blocked delete with clear dependency rules. |

---

### 5. Visualize operations (dashboards and maps)

Dashboards are built in a **configure → freeze → live** model: only **frozen** definitions drive production live views. Widgets bind by default to **endpoint groups**—the cohort of resolved devices on an endpoint—rather than fragile per-row legacy pointers.

Widget data is **prepared on the server** and delivered in a consistent envelope (status, message, typed payload). Preview and live share the same authorization and resolver—preview cannot bypass site or customer scope.

**Maps** show fleet position, heading, and health; marker detail supports **trend windows** (e.g. last hour and day) at device, endpoint, or site scope. **Expanded map intelligence** adds roster views, freshness and mobility classification, and historical paths from scrubbed event history.

**Customer intent → platform action**

| Customer says… | Platform delivers… |
|----------------|-------------------|
| “Show all trucks on this MQTT feed.” | Endpoint-group map/table/KPI widgets with server-side location filtering. |
| “Click a truck and see if speed dropped today.” | Map popup trends backed by rollup caches and durable time-series buckets. |
| “Air-gapped site—no public map tiles.” | Configurable map style URLs and offline-safe fallbacks. |

---

### 6. Govern device versions

Industrial fleets rarely upgrade uniformly. The platform treats each **device version** as an **immutable snapshot** of how that device was wired: scrubber definition, endpoint attachment, workflow links, and dashboard bindings at a point in time.

**Detection:** Firmware, software, or configuration fingerprints can be observed from **raw traffic** before scrubbing. Changes are recorded as evidence; they do **not** automatically rewrite production.

**Governance lifecycle:**

```text
Detected  →  (operator review)  →  Draft  →  Copy & compare artifacts  →  Activate Version  →  Active
                                                                              ↓
                                                                        Prior version deprecated
                                                                        Prior bindings frozen (audit only)
```

**Activate Version** is the customer-facing promotion step. It deprecates the previous active version, applies reviewed configuration to live paths, and records lineage for audits.

**Impact before promotion:** Operators can see which dashboards and workflows reference which fields, how schemas differ from the prior active version, and run **replay-style simulation** for structural risk (with deeper execution planned over time).

**Customer intent → platform action**

| Customer says… | Platform delivers… |
|----------------|-------------------|
| “Firmware 2.0 sends new fields—we must not break KPIs.” | New version row; dashboards resolve by stable attribute identity first, path second. |
| “We need to trial scrubber changes.” | Draft version with copied artifacts; promotion only after review. |
| “Who changed production last Tuesday?” | Lineage timeline, control-plane audit, and frozen summaries of superseded wiring. |
| “OTA is done outside this tool.” | Readiness metadata on devices; external rollout still creates version evidence when contracts change. |

**Explicit non-behavior:** Changing “OTA supported” or channel labels alone does **not** silently create a new production version—operators must **name and create** a version when they intend a cut.

---

### 7. Enterprise AI (structured first, LLM optional)

Enterprise AI answers operational questions using **declared field semantics**, not ad hoc parsing of every payload at question time.

- Fields carry **roles** (metric, identity, health, geo, grouping, display, filter, timestamp).
- Only fields marked **AI-exposed** appear in evidence shown to users or models.
- **Materialized projections** keep responses fast and consistent.
- **LLM** may summarize or explain **grounded evidence** when enabled; the platform must remain usable with LLM disabled.

**Customer intent → platform action**

| Customer says… | Platform delivers… |
|----------------|-------------------|
| “What’s the plate and last speed for unit 44?” | Identity and metric roles projected into evidence JSON. |
| “Don’t send PII to the model.” | `ai_exposed` gates and role-based retrieval. |
| “We need auditability.” | Catalog version and timestamp on each evidence bundle. |

---

### 8. Administer the deployment

Administration covers **users, sites, monitoring, LLM configuration, platform ports**, and **restore to default**. Full restore is a **destructive, two-step** operation (re-authentication plus explicit typed confirmation) that clears application and time-series data and reseeds only bootstrap configuration—intended for lab rebuilds or controlled resets, not casual use.

Site-scoped **roles and permissions** gate sensitive actions: version promotion, lineage read, audit read, simulation, and device writes.

---

## End-to-end operational story

A typical production journey:

1. **Register** devices with site, name, and profile metadata.  
2. **Configure** protocol endpoints and validate first payloads.  
3. **Publish** scrubber and identity rules so raw data becomes stable scrubbed state.  
4. **Build** frozen dashboards and workflows against endpoint groups.  
5. **Monitor** ingest health, liveness, alerts, and map/trend views.  
6. When devices or contracts change, **detect** drift, **review** impact, **activate** a new version deliberately.  
7. Use **Enterprise AI** for governed Q&A over the same semantic catalog operators defined in scrubbers.

```text
Devices & endpoints
       ↓
   Raw archive (always retained)
       ↓
   Scrubber (published contract)
       ↓
   Resolved devices & latest state
       ↓
   Workflows · Dashboards · Maps · Trends · Alerts · AI
       ↑
   Version governance (detect → review → activate)
```

---

## Translating customer requirements into actionable work

Use this matrix in discovery workshops. Each row is a testable outcome the platform is built to support.

| Customer requirement theme | Questions to ask | Actionable platform outcome |
|----------------------------|------------------|----------------------------|
| **Connectivity** | Which protocols? Push or pull? How many brokers? | Device endpoints, pollers, bridge grouping, ingest metrics |
| **Data custody** | Retention? Proof of receipt? | Raw archive, verify API, MinIO + metadata SoT |
| **Normalization** | Flat fields? Binary decoding? Units? | Scrubber studio publish, decode-series steps, field catalog |
| **Fleet scope** | Per site? Per line? Per endpoint topic? | Sites, endpoint groups, resolved-device cohorts |
| **Visualization** | KPI wall? Map? Table of assets? | Frozen dashboards, widget types, map intelligence |
| **Change management** | Firmware waves? Schema migrations? | Version detection, draft/review, impact, Activate Version |
| **Automation** | Alerts? External MQTT? ERP hook? | Workflows, published services, alert categories |
| **Analytics / AI** | Ad hoc questions? Compliance? | Role-based catalog, evidence JSON, optional LLM |
| **Operations** | On-prem? Air gap? Reset lab? | Docker deployment, map tile policy, restore to default |
| **Access control** | Who can promote versions? See audit? | Site RBAC, control-plane audit events |

---

## Boundaries and honest limits

Clarity on what the platform **does not** promise today helps set expectations:

| Topic | Boundary |
|-------|----------|
| **Fleet OTA orchestration** | No in-product campaign executor; rollout happens externally; governance records outcomes when contracts change. |
| **Silent auto-promotion** | Detection and ingest do not automatically switch production dashboards or scrubbers. |
| **Legacy per-row dashboard bindings** | New work uses endpoint groups and server-resolved widgets; legacy object bindings are not the forward path. |
| **Cloud SaaS / SSO** | Phase-one target is on-prem; multi-tenant contracts exist but license/cloud/SSO are later-phase concerns. |
| **Distributed compute grid** | Processing is Kafka + workers + Redis; not a Ray cluster in the baseline product. |

Open evolution areas—called out so customers can prioritize with you—include deeper simulation (full scrubber/workflow re-execution), richer firmware artifact libraries, complete migration of all dashboard pages to the unified widget resolver, and expanded decode modes for exotic binary payloads.

---

## Success measures

A deployment is succeeding when operators can answer—without opening database tools:

- **Is data arriving** for each configured endpoint?  
- **Which contract is live** for each device version?  
- **What breaks** if we activate the draft scrubber?  
- **Where are assets** and how did key metrics move in the last hour?  
- **Why does this version exist** (lineage and detection evidence)?  
- **What did AI use** to justify an answer (evidence roles, not raw dumps)?

---

## One-sentence positioning

**AAR IoT Studio is the place where industrial telemetry becomes governed operational truth—ingested reliably, transformed deliberately, visualized consistently, and changed only when operators choose to activate a new version.**

---

*This document describes product functionality for customers and implementers. It intentionally avoids implementation file references so it can be shared standalone in proposals, SOWs, and onboarding.*
