# Device Versioning, Schema Evolution & Compatibility — Final Spec Closures

Normative addenda. Implementation MUST conform to these locks.

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
