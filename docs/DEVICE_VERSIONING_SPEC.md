# Device Versioning, Schema Evolution & Compatibility — Final Spec Closures

Normative addenda. Implementation MUST conform to these locks.

**Implementation sequencing** (immutable `device_versions`, lineage extensions, routing): see **Delivered** / **Still open** in [ROADMAP.md](./ROADMAP.md) and sections below in this spec.

**Endpoint-level version detection** (raw-payload worker stage, Redis fingerprinting, async version-change events, execution before scrubber): [ENDPOINT_VERSION_IDENTITY.md](./ENDPOINT_VERSION_IDENTITY.md).

---

## 1. What exactly do Dashboards bind to?

❌ **Ambiguous today**

"Dashboards bind to schema"

This can be misread as:

- latest schema at endpoint level ❌ (dangerous)

✅ **Final Binding Rule**

Dashboards bind to:

**(schema_version + attribute_id references)**  
resolved at read time.

🧠 **Why**

- `schema_version` anchors structure  
- `attribute_id` anchors identity across renames  
- Prevents accidental drift when paths change  

**Example**

```json
{
  "widget_binding": {
    "schema_version": "schema-2",
    "fields": [
      {
        "attribute_id": "attr-speed",
        "path": "speed"
      }
    ]
  }
}
```

🔒 **Final Rule**

Dashboards MUST resolve fields using **attribute_id first**, **path second** (fallback).

---

## 2. Scrubber Version Drift (CRITICAL)

❌ **Problem**

If scrubber config changes but version doesn’t:

- baseline becomes invalid  
- simulation lies  
- compatibility breaks silently  

✅ **Final Rule**

ANY scrubber config change MUST produce:

- new `scrubber_version`  
- new `schema_version`  
- new `device_version`  

**Optional Hardening**

Add:

```json
{
  "scrubber_config_hash": "sha256-xxxx"
}
```

🔒 **Enforcement**

`scrubber_version` MUST be monotonic and immutable.

---

## 3. Shared vs Isolated Pipeline (v2 Handling)

❌ **Missing Definition**

Where does incompatible v2 data go?

✅ **Final Model**

**Shared Pipeline**

- default ingestion path  
- used by dashboards/workflows  
- ONLY compatible versions allowed  

**Isolated Pipeline (NEW)**

- candidate lane / quarantine lane  
- for incompatible versions  
- used for:  
  - simulation  
  - validation  
  - staging  

**Flow**

```
v2 arrives
↓
compatibility check
↓
IF compatible → shared pipeline
IF breaking → isolated pipeline
```

🔒 **Final Rule**

Breaking versions MUST NOT enter shared pipeline.

---

## 4. Endpoint Change — Version Explosion Control

❌ **Problem**

If endpoint changes:

Do all devices get new versions?

✅ **Final Rule**

Device Version is per `resolved_device_id`.

**Behavior**

- Endpoint reassignment: **ONLY affected device** gets new version  

**NOT allowed**

- mass version update for all endpoint devices  

🔒 **Rule**

Versioning is **device-scoped**, not endpoint-scoped.

---

## 5. schema_diff_engine Inputs (Lock)

❌ **Risk**

Different sources:

- compare uses stored schema  
- simulation uses inferred schema  

→ divergence  

✅ **Final Rule**

`schema_diff_engine` ALWAYS uses:

**(baseline_schema, candidate_schema)**  
derived from **device_version** records.

🔒 **Rule**

No live schema inference allowed in diff.

---

## 6. Async Pattern — Unified

❌ **Current inconsistency**

- simulate = async  
- compare = sync  

✅ **Final Rule**

All heavy operations are async:

- compare  
- simulate  
- impact (if large graph)  

**API Pattern**

- `POST /compare` → `job_id`  
- `GET /jobs/{id}` → result  

---

## 7. Edge Cases (Locked Behavior)

| Case | Behavior |
|------|----------|
| **Case 1: First-ever version** | `baseline = null`, `compatibility = "initial"`, auto-attach allowed |
| **Case 2: Reactivating old version** | `baseline` = previous **active** version (not latest by time) |
| **Case 3: Same schema_version, different manifest_hash** | Schema = **same**; Device version = **new** (due to drift rule); Compatibility = **compatible** |
| **Case 4: Partial payloads** | Missing field → null; **NOT** schema removal |

---

## 8. Version Drift Rule (Reinforced)

🔒 **Final Immutable Rule**

ANY change in:

- firmware  
- config  
- endpoint attachment  
- scrubber config  
- workflow binding  

→ MUST create new `device_version`

**Normative enumeration of version-creation triggers** (MUST be treated as creating a new `device_version` when applicable) — see **§13** for the closed list used by product and ingestion.

🚫 **Forbidden**

mutating existing version

---

## 9. Final System Truth Table

| Component | Source of Truth |
|-----------|-----------------|
| Schema | Scrubber |
| Version | Device Version Snapshot |
| Compatibility | schema_diff_engine |
| Impact | Static Graph |
| Simulation | Replay Engine |
| Prediction | Advisory Only |
| Dashboard Binding | schema_version + attribute_id |
| Superseded operational artifacts | `Frozen-Inoperable` (§14) |
| Lineage | Immutable version graph + explicit user/system events (§15) |
| KPI compare | Paired `device_version` snapshots + attribute_id-first alignment (§15) |

---

## 10. Final “No Drift” Guarantees

1. No schema inference  
2. No implicit version upgrades  
3. No silent dashboard changes  
4. No shared pipeline contamination  
5. No version mutation  
6. No spurious `device_version` when **§8** and **§13** triggers are absent  
7. No parallel operational use of superseded scrubber/endpoint/workflow/dashboard once **`Frozen-Inoperable`** (**§14**)  

---

## 11. Final One-Line System Definition

The platform treats every device version as an immutable, schema-bound snapshot; creating a new version freezes prior operational bindings as **`Frozen-Inoperable`**, carries forward **only** the scrubber definition as a copy, requires **explicit** endpoint wiring for the new version, and records **lineage** plus **KPI before/after** comparison; any promotion to shared workflows or dashboards still passes through the unified compatibility and simulation engine.

---

## 12. Existing data & migration (v1 constraint)

🔒 **Final rule — no required migration**

The versioning, schema-evolution, compatibility, routing, and UI capabilities described in this contract MUST be deliverable **without a mandatory bulk migration or rewrite of existing production data** (historical raw ingest, scrubbed stores, workflow outputs, dashboard bindings, and related artifacts remain valid as stored).

New structures (for example `device_version` records, candidate/isolated stores, routing policy, `attribute_id` metadata) MUST **layer on alongside** current data. Backfills, re-keys, or ETL MAY be used **optionally** for quality or performance, but MUST NOT be a prerequisite to ship or operate v1 of this model.

---

## 13. Version creation triggers (closed list)

A **new** `device_version` MUST be created when **any** of the following holds:

| # | Trigger | Definition |
|---|---------|------------|
| **1** | **Ingesting payload shape change** | The normalized ingest payload for the device (or resolved binding) **changes structure** in a way that affects schema or scrubber inputs (new/removed/retyped fields at the contract boundary — not mere value changes within the same shape). Detection MUST be deterministic (e.g. hash or structural diff of the ingest contract), not heuristic “silent widen”. |
| **2** | **Explicit version creation** | A user or API **explicitly** requests a new device version (e.g. “Create version”, branch for validation, promotion checkpoint). |
| **3** | **OTA updates** | Any **OTA-delivered** change that would alter firmware, config, or other versioned surface per **§8** MUST create a new `device_version` (OTA is not exempt from immutability). |

🔒 **Final Rule**

If none of **1–3** apply and no **§8** drift event applies, the platform MUST NOT mint a spurious `device_version`.

**v1 API (row 1):** `PATCH` to the device **`device_object`** mapping uses a deterministic fingerprint of **`fieldCatalog`** field entries (`path` / `attribute_id` / `type`) plus the frozen scrubber pipeline token; when it changes, the service mints a new `device_version` and appends lineage with `trigger_code=ingest_shape` (requires **`devices.write`** on the site). Pure ingest path shape drift without a mapping update is not yet wired to this trigger.

---

## 14. Prior version freeze on new version (Frozen-Inoperable)

When a **new** `device_version` is created (for any trigger in **§8** or **§13**):

✅ **Final Rule — prior version attachments**

For the **immediately previous** `device_version` (the superseded snapshot), each of the following MUST be transitioned to status **`Frozen-Inoperable`**:

- the **scrubber** definition bound to that version  
- the **endpoint** bound to that version  
- any **workflow** bindings scoped to that version  
- any **dashboard** bindings scoped to that version  

**Semantics of `Frozen-Inoperable`**

- MUST NOT participate in **live** ingestion, shared pipeline routing, or operational execution.  
- MUST remain **readable** for audit, lineage, compare, and rollback visibility.  
- Promotion back to operability MUST follow an **explicit** lifecycle (out of scope of this subsection, but MUST NOT auto-unfreeze on unrelated events).

✅ **Final Rule — what carries forward**

- **Only** the **previous scrubber definition** (the superseded version’s scrubber snapshot) MUST be **copied** onto the new version as the **starting** scrubber draft (immutable copy of definition text/config as of cut-over — not a live pointer to the frozen row).  
- **Endpoint**, **workflow**, and **dashboard** attachments for the **new** version MUST **NOT** auto-copy from the prior version.  
- The user MUST **explicitly** complete: **Freeze** (where applicable in the product flow) and **create / attach an Endpoint** for the new version before that version can be considered operationally wired for live traffic (no implicit re-bind).

🚫 **Forbidden**

- leaving the superseded version’s scrubber/endpoint/workflow/dashboard **active** alongside the new version for shared operational use  
- silently cloning endpoint or dashboard bindings onto the new version  

---

## 15. Lineage & KPI comparison

✅ **Lineage (final rule)**

- **Lineage** MUST record: version creation triggers (**§13**), supersession links (**previous** `device_version` → **new**), transitions to **`Frozen-Inoperable`**, explicit endpoint/scrubber actions, and OTA identifiers where applicable.  
- Lineage MUST be sufficient to answer: *why* this version exists, *what* changed at the contract boundary, and *which* artifacts were frozen.

✅ **KPI comparison (final rule)**

- The product MUST provide a **before / after** comparison of **KPIs** between two selected `device_version` records (typically **previous vs new** immediately after a version cut, and arbitrary pairs for audit).  
- Comparison SHOULD align metrics by **`attribute_id`** where bound to dashboards; where not available, path-aligned fallback per **§1** ordering (**attribute_id first**, **path** second).  
- Missing KPI on one side MUST render as **explicit null / “not present”**, not as zero or silent match.

🔒 **Implementation note**

Heavy diff/compare remains subject to **§6** (async job pattern where appropriate).

### 15.1 Bootstrap lineage persistence (caller-owned commit)

The first persisted row for a device (bootstrap trigger) may be created when a read path needs lineage but no row exists yet (for example **`GET /devices/{id}/version-lineage`**), via **`ensure_bootstrap_lineage_row()`**.

**Current behavior:** that helper **only `flush()`**es; it **does not** `commit()`. The **caller** must commit the session so the bootstrap row (and linked **`device_versions`** row) persists. Examples: **`GET /devices/{id}/version-lineage`** commits after building the response; **`register_device`** and **CSV import** commit after bootstrap; write paths that record lineage already commit at the end of the handler.

**Tests** should treat read-triggered bootstrap as an intentional side effect of the lineage GET when documenting session behavior.

---

## 16. v8 Device Registration (metadata-only slice)

Normative addendum for the **v8** “Manage Devices” registration/edit flow: persist **identity**, **device profile**, and **declared OTA readiness** only (no endpoint linking, no scrubber mapping, no OTA job execution). This section **narrows** when that flow may mint a `device_version` relative to the general triggers in **§8** and **§13**; it does **not** relax OTA-delivered versioning (**§13** row **3**) or ingest/shape triggers elsewhere.

### 16.1 Initial version on register

On successful **device registration**, the platform **already creates** an initial `device_version` (bootstrap lineage). Subsequent edits use the rules below unless superseded by **§13** / **§8** from other subsystems (e.g. OTA completion, ingest shape change).

### 16.2 Semantics of `firmware_channel = custom`

**`custom`** means: the device’s firmware was **updated outside OTA campaigns** (operator- or integration-declared lane). It is **not** a policy approval flag; campaign policy remains a separate concern.

Allowed values elsewhere in v8 metadata: `stable` \| `beta` \| `dev` \| `custom` (default `stable`).

### 16.3 When Tab 3 edits mint a new `device_version` (v8 carve-out)

**For changes applied only through the v8 Device Registration modal (Tab 3 — declared metadata):**

- **`ota_supported`**, **`rollback_supported`**, and **`firmware_channel`** are **device metadata only**; changing them **does not** auto-mint a `device_version` or bump `devices.device_version`.
- A **new** `device_version` MUST be created only when **§13** row **2** applies — **Explicit version creation** (user or API supplies a **new** `device_version` label, e.g. `PATCH /devices/{id}` with `device_version`, or **Device details → Versions → Add version** in the UI).

**v1 API enforcement:** The API records a new immutable `device_versions` row and lineage transition (`trigger_code=explicit`) only when the JSON body **includes the `device_version` field** and its value differs from the stored label. Requests that change readiness or channel fields without `device_version` update metadata only.

**For v8, do not** auto-mint a `device_version` solely from Tab 3 edits to **`hardware_version`**, **`firmware_version`**, **`firmware_channel`**, **`rollback_supported`**, or **`ota_supported`** without an explicit new version label. Telemetry, ingest-shape, and endpoint identity detection remain governed by **§8** / **§13** outside this subsection.

### 16.4 Save UX (create and edit)

The same modal and tabs are used for **create** and **edit**. There is **one** primary action (**Create Device** / **Save Changes**); **no** per-tab save.

On submit:

- Validate **all** tabs.
- On failure, **focus** the first invalid control and **navigate** to the tab that contains it.
- Keep validation messages **attached to fields** (programmatic association for assistive tech).

Accessibility for tabs: **tablist** / **tab** / **tabpanel**, keyboard navigation, **`aria-selected`**, **`aria-controls`** (and related patterns per platform guidelines).

### 16.5 Uniqueness (per `site_id`)

Enforce **uniqueness per site** among devices for:

- **Device Name** (required; stable operator-facing name for list, logs, admin UI).
- **Display Label** — when set (non-empty), MUST be unique at that site alongside name rules as implemented (no duplicate label text for two devices at the same site).
- **Device ID** — the stable **device identifier** field intended for integrations (distinct from display label and human-facing name); when non-null, MUST be unique per site. **Note:** the platform-assigned primary key (`id`, UUID) is globally unique by definition; per-site uniqueness rules apply to the **business** identifiers above, not to re-validating the UUID.

### 16.6 Version compare, simulation, and impact analysis (not in registration)

**v8 registration** remains **identity + readiness metadata** only. It MUST NOT grow into a **versioning cockpit** (paired KPI compare, simulation targets, promote/rollback, or impact analysis).

Those flows belong on **Operational lineage** / **Device details** / **Version history** (and later Phase 2+ workflows), where **`device_version`** selections and snapshots are the primary model. Deep links may open related drawers from elsewhere; **query parameters such as `compareA` / `compareB` on the registration URL are intentionally unused** by the registration UI until a later phase explicitly scopes them.

---

## What you now have

You now have a production-grade, enterprise-safe contract that:

- ✔ Supports OTA without breaking dashboards  
- ✔ Supports schema evolution safely  
- ✔ Handles mixed fleet versions  
- ✔ Enables simulation before promotion  
- ✔ Prevents silent drift  
- ✔ Defines explicit **version-creation triggers** (payload shape, explicit create, OTA) — §13  
- ✔ Freezes superseded **scrubber / endpoint / workflow / dashboard** as **`Frozen-Inoperable`**, copies **only** the prior scrubber forward, and requires **explicit** endpoint (re)creation — §14  
- ✔ Requires **lineage** and **KPI before/after** comparison across versions — §15  
- ✔ Locks **v8 device registration** semantics: initial version on register, `custom` channel meaning, narrowed Tab 3 version bumps, global save + tab-aware validation, per-site uniqueness — §16  
