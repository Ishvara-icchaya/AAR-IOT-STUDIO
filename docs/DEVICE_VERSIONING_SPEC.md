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

---

## 10. Final “No Drift” Guarantees

1. No schema inference  
2. No implicit version upgrades  
3. No silent dashboard changes  
4. No shared pipeline contamination  
5. No version mutation  

---

## 11. Final One-Line System Definition

The platform treats every device version as an immutable, schema-bound snapshot, and any change must be validated through a unified compatibility and simulation engine before it is allowed to influence shared workflows or dashboards.

---

## 12. Existing data & migration (v1 constraint)

🔒 **Final rule — no required migration**

The versioning, schema-evolution, compatibility, routing, and UI capabilities described in this contract MUST be deliverable **without a mandatory bulk migration or rewrite of existing production data** (historical raw ingest, scrubbed stores, workflow outputs, dashboard bindings, and related artifacts remain valid as stored).

New structures (for example `device_version` records, candidate/isolated stores, routing policy, `attribute_id` metadata) MUST **layer on alongside** current data. Backfills, re-keys, or ETL MAY be used **optionally** for quality or performance, but MUST NOT be a prerequisite to ship or operate v1 of this model.

---

## What you now have

You now have a production-grade, enterprise-safe contract that:

- ✔ Supports OTA without breaking dashboards  
- ✔ Supports schema evolution safely  
- ✔ Handles mixed fleet versions  
- ✔ Enables simulation before promotion  
- ✔ Prevents silent drift  
