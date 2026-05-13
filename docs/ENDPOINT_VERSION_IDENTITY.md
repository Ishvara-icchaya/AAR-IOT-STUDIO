# Endpoint Version Identity Detection

Bounded feature: detect firmware/software/config/version changes from **raw inbound payloads** before scrubber execution, without synchronous `device_version` / lineage writes on the ingest path.

Normative for this feature. Implementation MUST conform to the locks below.

**Related:** device versioning, lineage, and routing — [DEVICE_VERSIONING_SPEC.md](./DEVICE_VERSIONING_SPEC.md). OTA / phases — [OTA_VERSION_LINEAGE_PHASES.md](./OTA_VERSION_LINEAGE_PHASES.md).

---

## One-line contract

Endpoint Version Identity Detection is a **raw-payload worker-stage** that identifies firmware/software/config changes using **cached JSONPath extraction** and **Redis fingerprint comparison**, then emits **async version-change events** without synchronously mutating `device_version` or lineage records during ingest.

---

## Final implementation locks

1. **Endpoint owns config** — JSONPath mappings, discovery policy, fingerprint rules, missing-field policy, `discovery_completed` / `discovered_at`.
2. **Worker executes detection** — Not FastAPI request handling; aligns with Kafka → worker → scrubber → `v2_resolution`.
3. **Detection uses raw JSON** — Parsed from the same bytes/object as MinIO raw / ingest envelope (not scrubber output).
4. **Detection runs before scrubber** — After raw load, before scrubber semantics and before LDS persistence.
5. **Redis compares fingerprints** — Hot path: read previous fingerprint/values, compare, write new state only on change.
6. **Event published only on change** — Dedupe so one logical event per new fingerprint per resolved identity (see below).
7. **No synchronous `device_version` creation on ingest** — Persistence, lineage, candidate routing, validation happen in async consumers.
8. **`resolved_device_id` bootstrap** — Before a stable `resolved_device_id` exists, use a temporary cache key scoped by endpoint + primary key hash (see Redis keys).
9. **Cache migration** — After `v2_resolution` creates or resolves `resolved_device`, migrate fingerprint cache from the bootstrap key to the `resolved_device` key.
10. **Version state does not go into `identity_json`** — `identity_json` remains primary-key identity only; version flags live under **`system_json.version_identity`** (see Schema decision).

---

## Runtime location

| Concern | Owner |
|--------|--------|
| Config storage, discovery policy, paths, fingerprint field list | **Endpoint** (and optional normalized table later) |
| Load raw payload, extract values, fingerprint, Redis compare, dedupe, publish | **Worker** (ingest / scrubber pipeline stage **before** scrubber) |
| Hot compare state | **Redis** |
| `device_version`, lineage, candidate routing, validation | **Async worker(s)** consuming version-change events |
| Scrubber | **Unchanged** — schema semantics, KPIs, workflow inputs |

---

## Pipeline order (target)

Current ingest shape (recommended):

1. Raw ingest → Kafka / raw queue (as today).
2. Worker loads **raw** payload.
3. **Version identity detection** (raw JSON): extract configured paths, compute fingerprint, Redis compare.
4. If fingerprint changed (and policy allows): optional **`version_change_detected`** (or equivalent) event; update Redis; optional LDS **`system_json`** flags on next LDS write (see below).
5. **Scrubber execution** (unchanged).
6. **`v2_resolution`** — `resolved_device` create/update, scrubbed event, LDS upsert.
7. **Migrate** Redis fingerprint key from bootstrap (`endpoint` + `pk_hash`) to **`resolved_device`** key when `resolved_device_id` first becomes stable.

Scrubber must **not** be required for version detection (passthrough / no-scrubber flows must still run detection on raw JSON).

**REST ingest, archive replay, and passthrough** MUST apply the same version-detection behavior (no divergence by entry path).

---

## Raw vs scrubbed (locked)

- **Use RAW payload** for JSONPath extraction and fingerprint input.
- **Do not** run version identity solely on scrubber output — avoids field renames, flattening, and schema-dependent drift.

---

## Redis key strategy (bootstrap + steady state)

**Before `resolved_device_id` exists:**

```text
version:fingerprint:endpoint:{endpoint_id}:pk:{primary_key_hash}
```

(And companion keys as needed, e.g. last values / dedupe, with the same bootstrap scope.)

**After `resolved_device` exists:**

```text
version:fingerprint:rdev:{resolved_device_id}
```

**Migration:** after `v2_resolution` yields `resolved_device_id`, copy or re-point cached fingerprint state from the bootstrap key to the `rdev` key and retire the bootstrap key for that PK.

---

## Fingerprint (normative sketch)

1. Extract values for configured keys from raw JSON (JSONPath or internal path model).
2. Normalize: trim strings; lowercase **field keys** in the canonical object; optional value-case rules per config; **sort keys alphabetically**; omit null/missing unless marked required.
3. `fingerprint = sha256(canonical_json(version_identity_values))`.

---

## Events and topics

- Publish **only on fingerprint change**, with **dedupe** (e.g. `resolved_device_id` + new fingerprint, or bootstrap equivalent).
- Recommended topic name (align with existing `latest_device_state.updated` style): **`latest_device_version.changed`** (alternative: `device_version.changed` — pick one and register in ops/taxonomy).

Event payload SHOULD include tenant/site/endpoint/`resolved_device_id`/`device_id` (registered device where known), previous/new fingerprint and value maps, `source: endpoint_version_identity`, `observed_at`, and **`raw_object_id`** (align naming with existing envelopes; avoid parallel opaque `raw_event_id` unless aliased).

---

## LDS: where version flags live (schema decision)

**Do not** store version identity state in `identity_json` (PK identity only).

**Do not** overload `display_json` for platform runtime flags (`display_json` = user-facing display payload).

**Add** to `latest_device_state`:

```sql
system_json JSONB NOT NULL DEFAULT '{}'
```

Store version detection state at:

```text
system_json.version_identity
```

Example shape:

```json
{
  "version_identity": {
    "fingerprint": "sha256-…",
    "changed": true,
    "pending_validation": true,
    "firmware_version": "1.2.0",
    "config_version": "cfg-17",
    "observed_at": "2026-05-08T12:00:00Z"
  }
}
```

UI copy such as “Version change detected / Pending validation” derives from this block.

---

## Endpoint configuration (conceptual)

Config is owned by the endpoint (e.g. namespaced JSON on the endpoint row — avoid mixing with secrets; if using `auth_config`, isolate under a dedicated top-level key such as `version_identity`).

Include:

- `enabled`, `auto_discover`, `discovery_mode` (e.g. first payload only), `discovery_patterns`
- `paths` (JSONPath → logical field keys)
- `fingerprint_fields`
- `missing_field_policy` (required fields, tolerance counts, behavior on missing)
- **`discovery_completed`**, **`discovered_at`** — auto-discovery runs **once** until operator triggers a manual refresh; prevents “first payload forever” rescans.

Manual path mappings **override** auto-discovered paths for the same logical key.

---

## Performance and safety (must / must not)

**Must**

- Use cached configured paths after discovery (no full-document key scan every ingest).
- Extract only configured fields for fingerprint input.
- Keep fingerprint computation lightweight.
- Compare against Redis; publish async event only on change.

**Must not**

- Scan the full raw payload every ingest for discovery (after `discovery_completed`).
- Write `device_version` or lineage synchronously on the hot ingest path.
- Block scrubber completion on async version persistence.

---

## Acceptance criteria (feature-level)

- Endpoint can auto-discover version fields from the first payload (then lock via `discovery_completed` unless refreshed).
- Endpoint can store manual custom version fields; manual overrides discovery.
- Subsequent ingests use configured paths only (no repeated full discovery).
- Fingerprint comparison uses Redis; **no** hot-path DB write for unchanged fingerprint.
- Version-change event: **at most one deduped** publish per new fingerprint per identity scope.
- Async consumer creates lineage / `device_version` behavior only on real change (per product rules).
- Payload continues through scrubber and `v2_resolution` regardless of detection outcome (unless a separate policy explicitly quarantines, which is out of scope for this doc).

---

## Summary table

| Layer | Responsibility |
|-------|------------------|
| Endpoint | Config, paths, discovery policy, fingerprint rules, discovery completion flags |
| Worker (pre-scrubber) | Raw parse, extract, fingerprint, Redis compare, dedupe, publish |
| Redis | Last fingerprint, last values, dedupe / bootstrap keys |
| Async consumers | `device_version`, lineage, candidate routing, validation |
| Scrubber | Schema semantics, KPIs, workflow inputs — independent |
| LDS `system_json` | Platform/runtime version identity flags and last observed values |
