# Semantic field catalog & Enterprise AI — design note

**Implementation (Phase 1):** `device_objects.mapping.fieldCatalog` (versioned catalog JSON), `services/api/app/services/field_catalog_service.py` (+ worker copy), validation on `PATCH /device-objects`, `data_objects.ai_projection` populated by worker-scrubber on insert, scrubber preview returns `ai_projection`, Enterprise AI `data_object_catalog` reads projections. Further phases: richer validation, UI editor, migration off intent heuristics per §10.  
**Scope:** generic across all ingested/scrubbed data — not fleet-specific.  
**Compatibility:** today’s fleet-ish intent routing, KPI key substring matching, and identity sampling from KPI keys are **temporary scaffolding only**; they must not become the long-term model.

---

## 1. Goals (locked target)

1. **Field roles are first-class metadata** — declared per scrubbed object definition, persisted and versioned with the definition that produces `data_objects`.
2. **KPI stays clean** — numeric, trendable, aggregatable, graphable; not a dumping ground for plates, VINs, asset tags, or arbitrary identifiers.
3. **Enterprise AI retrieves by role** — latest relevant objects → load field catalog → project fields by role (and optional `ai_exposed`) → stable evidence JSON → optional grounded LLM summarization.
4. **No long-term reliance on heuristics** — no dataset-specific AI routing, substring identity inference, or “special case fleet plates” as the primary mechanism.

---

## 2. Role enum

Roles are **multi-assignable** per field. Minimum set:

| Role | Meaning (informative) |
|------|------------------------|
| `metric` | Numeric (or coerced numeric) series / aggregates; trend & chart oriented |
| `identity` | Business identifiers: asset id, serial, plate, VIN, user id, etc. |
| `health` | Domain health / quality / alarm-like state carried in payload (distinct from top-level `data_objects.health_*` when both exist) |
| `geo` | Latitude, longitude, altitude, route, region, etc. |
| `grouping` | Dimensions for rollups: site, line, zone, customer, device, unit class |
| `display` | Human-facing labels for summaries, tables, popups, AI narrative |
| `filter` | Fields useful for narrowing queries / faceted retrieval |
| `timestamp` | Event time, observed time, ingested time (which path is canonical is catalog metadata) |

**Extensibility:** new roles may be added in a controlled enum with migration and UI support; v1 ships the set above.

---

## 3. Field catalog JSON shape

Canonical catalog is a **versioned** document attached to the **object / scrubber definition** (not recomputed only at query time).

**Suggested top-level shape:**

```json
{
  "version": 3,
  "fields": [
    {
      "path": "license_plate",
      "label": "License Plate",
      "type": "string",
      "roles": ["identity", "display", "filter"],
      "ai_exposed": true,
      "description": "DOT license plate as reported by telematics"
    },
    {
      "path": "speed_mph",
      "label": "Speed",
      "type": "number",
      "roles": ["metric", "display"],
      "ai_exposed": true
    },
    {
      "path": "event_ts",
      "label": "Event time",
      "type": "datetime",
      "roles": ["timestamp", "filter"],
      "ai_exposed": true
    }
  ]
}
```

**Field entry rules (normative intent):**

- `path` — JSON path into **scrubbed payload** (or agreed root: payload vs normalized object); dot or JSON Pointer to be chosen once and used consistently.
- `label` — required for `display` or `ai_exposed` fields (UX + LLM grounding).
- `type` — `string` | `number` | `boolean` | `datetime` | `geo_point` | … (enum TBD; used for validation and projection).
- `roles` — non-empty array of role enum values.
- `ai_exposed` — default `false`; only `true` fields may appear in Enterprise AI evidence (defense in depth).
- `description` — optional; helps operators and prompt hygiene.

---

## 4. Storage location & versioning

**Canonical home:** **object definition / scrubber definition metadata** — the same artifact that is authoritative for “how this device’s raw data becomes a `DataObject`” (e.g. `device_objects.mapping` / scrubber studio published graph), **versioned** with scrubber template hash or explicit `catalog_version` monotonic integer.

**Not canonical:**

- Ad-hoc derivation at query time only (may be used as a **read cache**, not source of truth).
- Duplicated catalogs per row without definition linkage (drift risk).

**Versioning rules:**

- Every catalog document has `version` (integer).
- On publish: bump version; persist with definition; scrubber runs validate against published catalog.
- `data_objects` rows (or side projection) should be able to reference **`definition_id` + `catalog_version`** used at materialization time (exact FK shape TBD in implementation).

---

## 5. Materialized AI projection (performance)

Enterprise AI **must not** parse full raw/scrubbed payloads on every chat.

**Materialize** a compact projection for “latest object” reads, built from:

- latest values (payload and/or `data_object_details` / `latest_detail_id` policy — align with product truth for “as of”),
- field catalog,
- role-filtered + `ai_exposed` projection.

**Physical options (pick one in implementation plan):**

- **JSONB column** on `data_objects` (e.g. `ai_projection`) updated on scrub/write, or
- **Side table** `(data_object_id, catalog_version, projection, updated_at)`, or
- **Cached layer** (Redis) with DB as source of truth — only if invalidation is proven correct.

Projection is **rebuilt** when catalog version or scrubbed payload for that object changes.

---

## 6. Scrubber / publish validation rules

At **definition publish** time (and optionally on scrub dry-run):

| Rule | Severity |
|------|----------|
| At least one field has role `timestamp` | **Error** (block publish) or **Warn** + policy flag (product decision) |
| Warn if no `identity` and no `display` and no `filter` | **Warn** |
| `geo`: if `latitude`/`longitude` paths are used, require **paired** catalog entries or a single `geo_point` type with documented structure | **Error** |
| `metric`: type must be `number` (or coercible) and paths must resolve | **Error** |
| Duplicate **semantic** conflicts (e.g. two fields both sole canonical `timestamp` without priority) | **Warn** or **Error** (TBD) |
| `ai_exposed: true` requires `label` and at least one of `display` \| `identity` \| `metric` \| `health` \| `geo` \| `filter` \| `timestamp` | **Error** |
| KPI spec must **not** require identity-only paths to be registered as metrics for AI to “see” them | **Lint** — identity belongs in catalog, not KPI hacks |

---

## 7. Enterprise AI evidence JSON shape (contract)

Stable shape for LLM + UI “Evidence” tab. **Keys are roles**, values are **plain projections** (scalar or small nested objects), all from declared catalog paths only.

**Example (illustrative):**

```json
{
  "object_type": "fleet_telemetry",
  "catalog_version": 3,
  "asof_ts": "2026-04-22T10:30:00Z",
  "identity": {
    "license_plate": "ABC123",
    "truck_id": "TRK-44"
  },
  "display": {
    "status": "late",
    "site": "Phoenix Yard"
  },
  "metrics": {
    "speed_mph": 62,
    "fuel_pct": 41
  },
  "health": {
    "payload_status": "warning"
  },
  "geo": {
    "lat": 33.45,
    "lon": -112.07
  },
  "grouping": {
    "site_id": "…",
    "line": "A1"
  },
  "filter": {
    "region": "SW"
  },
  "timestamp": {
    "event_ts": "2026-04-22T10:29:58Z"
  }
}
```

**Contract rules:**

- Only fields with `ai_exposed: true` appear.
- Omitted role buckets may be `{}` or omitted — pick one and document for the frontend.
- `object_type` is a stable string from definition (not free-form user text).
- `asof_ts` comes from agreed timestamp role or `latest_seen_at` policy.

**Question intent → role projection (generic):**

- “IDs / plates / names” → prioritize `identity`, `display`, `grouping`.
- “Above 80 / critical / trend” → `metric`, `health`, `timestamp` + bounded series from existing Timescale/KPI paths where applicable.
- Narrowing → `filter` + site scope already enforced by policy.

Exact mapping from **natural language** to **role sets** may remain a **small, generic** classifier (not per-vertical string lists on field names).

---

## 8. Retrieval pattern (end state)

1. **Resolve** object type(s) and site/time scope (existing planner + policy).
2. **Load** latest objects (+ materialized projection or build projection from payload + catalog once per batch).
3. **Load** field catalog for those definition versions.
4. **Project** evidence JSON per object (role buckets, `ai_exposed` only).
5. **Assemble** evidence array + metadata (row counts, clamp flags, catalog_version).
6. **Optional** grounded LLM on the evidence contract only.

---

## 9. KPI purity (non-negotiable)

- KPI JSON / Timescale KPI pipeline: **metrics only** (and existing displayFields policy should **migrate** toward catalog-driven `display` / `metric` roles rather than growing ad hoc keys for AI).
- **Do not** add plates, VINs, tags, or arbitrary strings to KPI solely for Enterprise AI visibility — use **identity** role + catalog + projection.

---

## 10. Migration plan away from heuristics

| Phase | Action |
|-------|--------|
| 0 | Treat current: `data_object_catalog` intent, KPI key fragments, `kpi_identity_sample` heuristics as **bridge only**; document in code comments referencing this note. |
| 1 | Add catalog to definition storage; publish + validate; optional UI for roles. |
| 2 | On scrub/write, materialize `ai_projection` (or side table) from catalog + payload. |
| 3 | Add Enterprise AI code path: **evidence from projection** when `catalog_version` present; fallback to legacy heuristic path if catalog missing. |
| 4 | Backfill catalogs for high-value definitions; turn warnings into errors per tenant rollout. |
| 5 | **Remove** heuristic identity extraction, substring matching, and dataset-specific routing; collapse intents where planner can choose “catalog projection” generically. |

---

## 11. What to retire after semantic layer lands

Progressively delete or bypass:

- Dataset-specific Enterprise AI routing (e.g. fleet-only branches).
- Substring / fragment matching on KPI key names for “identity.”
- Special-case “fleet plate” or similar vertical hacks.
- Any logic that forces identity into KPI for AI consumption.

---

## 12. Suggested close note to developers

We agree with this direction. Please treat the current fleet / KPI key–fragment logic as a **temporary compatibility path only**. The target architecture is:

- A **generic field-role semantic layer** for all ingested/scrubbed data.
- **KPI** remains metric/trend oriented.
- **Enterprise AI** uses: **latest ingested values** + **declared field-role metadata** + **grounded evidence projection** + optional **LLM summarization**.

Before coding, use this note as the checklist: **role enum**, **catalog JSON shape**, **storage + versioning**, **scrubber/publish validation**, **evidence contract**, **materialized projection**, **migration off heuristics**.

This is the right foundation for fleet, vibration, energy, alarms, REST metrics, and arbitrary custom JSON — **one platform model**.
