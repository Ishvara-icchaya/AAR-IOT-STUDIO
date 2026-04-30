# Map popup & trend windows — architecture contract (draft)

This document records **agreed direction** for map marker detail UX, numeric presentation, and **1h / 24h trend** data (device + endpoint rollups, storage, workers, and client shape). It is a **contract for implementation**; it does not replace OpenAPI until endpoints and schemas are added.

**Related context:** Today the map uses **HTML string** popups (`MapWidget` → `popupContentFromDetail`). Target state is a **React tree** in the MapLibre popup with **lazy-loaded** trend/chart UI and a **typed API** for windowed rollups.

---

## 1. Goals

1. **Operator questions:** Support questions such as “What was my truck speed in the **last 1 hour**?” and the same class of question over **24 hours**, with **readable** numbers and **trend** context (not only a single latest value).
2. **Aggregations:** Per bucket, expose at least **avg, min, max**, and **std dev** where statistically meaningful, on a **fixed bucket cadence** (default **5 minutes** unless changed by a later revision).
3. **Two rollup surfaces:**
   - **Device (resolved-device) level** — canonical series for a single asset.
   - **Endpoint level** — rolled up across devices under an endpoint (and object/site scope as already modeled elsewhere), for fleet-style map popups and fewer reads when scanning many markers.
4. **Performance:** Hot path for popup reads should be **fast** (Redis and/or narrow Timescale queries); **heavy aggregation** should not run **on each popup open**.
5. **Presentation rules:** **Integers** render as **whole numbers (no decimals)**; **floats** render **rounded to 2 decimal places** (presentation layer; type- or metadata-driven, not string heuristics).

---

## 2. Definitions

| Term | Meaning |
|------|--------|
| **Bucket** | A fixed time interval (default **5 minutes**) for which rollups are computed and stored. Buckets are **immutable once closed**; the “current” bucket may be **partial** (see §6). |
| **Moving window** | **Query-time** selection of buckets whose time range overlaps **last 1h** or **last 24h** relative to a defined **as-of** time (usually “now” or “last sample time”). Windows are **not** recomputed by scanning raw events on every UI open. |
| **Device rollup** | Metrics aggregated for one **resolved device** (or equivalent identity) over buckets. |
| **Endpoint rollup** | Same metric definitions, aggregated across the **cohort** of devices bound to an **endpoint** (and scoped by site/object as required by the product). |
| **Trend** | Ordered series of bucket-level stats (and optionally sub-bucket detail where available) suitable for **sparkline / small chart** UI. |
| **Popup shell** | MapLibre `Popup` content host: **React root** (or framework-approved pattern), **lazy** chart/trend modules, explicit **loading / error / empty** states. |

---

## 3. Numeric presentation (UI contract)

| Value kind | Display |
|------------|--------|
| **Integer** (counts, discrete states encoded as ints) | **No** fractional part (e.g. `42`, not `42.00`). |
| **Float** (continuous metrics: speed, temperature, etc.) | **Two** decimal places (e.g. `63.47`). |
| **Non-numeric** (IDs, enums, labels) | **No** numeric rounding; pass through as text. |
| **Coordinates / special fields** | May override defaults (e.g. lat/lon precision) via **field metadata** in a later revision; until then, document exceptions per field in the binding/schema catalog. |

Formatting is a **presentation** concern; **stored bucket values** should retain **full precision** appropriate for downstream math (see §5).

---

## 4. Bucket schema (logical contract)

Each **closed** bucket (per metric, per rollup entity) should support at minimum:

- **Bucket identity:** `bucket_start` (UTC), `bucket_width` (e.g. `5m`), rollup **entity** (device id vs endpoint id + scope), **metric key**.
- **Aggregates:** `n` (sample count in bucket), `min`, `max`, `sum` (for avg = sum/n), and inputs needed for **std dev** (e.g. `sumsq` for population or sample variance — **choose one** and document in schema migration).
- **Semantics:** **std dev** is only meaningful when **n ≥ 2** (or when sub-sample variance is defined); product may show **“—”** or hide when undefined.

**Partial bucket:** the bucket containing **as-of** may be incomplete; mark **`partial: true`** or omit from “closed” rollup tables until closed, per implementation choice.

---

## 5. Storage layers (contract)

| Layer | Role |
|-------|------|
| **Durable time-series store** (e.g. Timescale) | **Source of truth** for bucket rows (and/or raw samples if buckets are derived in batch). Supports **backfill**, **audit**, and **recompute** if logic changes. |
| **Redis** | **Hot cache** for “last 1h / 24h” **window reads** and/or **pre-materialized** endpoint/device summaries used by the map popup API. Keys and TTLs must be **explicit** in a follow-on “Redis key catalog” section or doc. |
| **API DB** (Postgres) | Metadata only unless buckets are also mirrored here by design; **default** is TS + Redis for series. |

**Retention (default intent):** retain enough **5m buckets** to cover **24h** at minimum for popup/trend; longer retention is a **product/cost** decision (separate from this contract unless fixed here).

---

## 6. Moving windows (1h and 24h)

- **1h window:** all **closed** (and optionally **current partial**) buckets with `bucket_start >= as_of - 1h` and `bucket_start < as_of` (exact inequality rules to be aligned with **inclusive/exclusive** end in implementation).
- **24h window:** same pattern over **24 hours**.
- **As-of time:** default **`now`**; may use **last event timestamp** for stale devices (product decision — document in API if supported).

**Endpoint rollup:** same window logic, but each bucket’s values are aggregated **across the device cohort** for that endpoint (and scope). Definition of “cohort membership” at bucket time must match **v2 endpoint / resolved device** models already in the platform.

---

## 7. Workers & write path (contract)

- **Rollups must not** depend solely on **popup open** for correctness; a **worker or ingest-side path** must **update or finalize** buckets (or enqueue work) when **new scrubbed / sample data** arrives or on a **schedule** (e.g. close 5m buckets).
- **Read path:** popup and map clients call a **narrow API** (see §8) that returns **windowed** series + optional **summary row** (e.g. last bucket, min/max over window).

Exact worker placement (ingest vs scheduler vs dedicated rollup service) is **implementation detail** but must satisfy: **bounded latency** from ingest to **queryable** rollups for “live” map use cases, or documented **staleness SLA**.

---

## 8. API contract (illustrative — to be formalized in OpenAPI)

**Principle:** one or a few endpoints return **ready-to-render** structures for the React popup (trend series + summary), keyed by **resolved device** and/or **endpoint** + **metric set** + **window**.

Illustrative request (shape only):

```http
GET /api/v1/.../trend-window?entity_type=resolved_device|endpoint&entity_id=...&window=1h|24h&metrics=speed,rpm&bucket=5m
```

Illustrative response (shape only):

```json
{
  "window": "1h",
  "bucket": "5m",
  "as_of": "2026-04-29T12:00:00Z",
  "metrics": {
    "speed": {
      "buckets": [
        { "t": "2026-04-29T11:00:00Z", "n": 12, "avg": 62.3, "min": 0, "max": 71.2, "std": 4.1 }
      ],
      "summary": { "n_total": 144, "avg": 61.8, "min": 0, "max": 72.0 }
    }
  }
}
```

**Pagination / max buckets:** cap response size for 24h at 5m (`≤ 288` buckets per metric) unless client requests **downsampled** series in a later revision.

---

## 9. Map popup UI contract (target)

| Requirement | Detail |
|-------------|--------|
| **React tree** | Popup content is **not** built from ad hoc HTML strings for production detail; use a **mounted React** subtree (create root / unmount on popup close) or an equivalent approved pattern. |
| **Lazy loading** | Chart / trend bundles **load on open** (or when the marker requires them), not on initial map load. |
| **Layout** | Support **multi-column** layout inside the popup where product requires (e.g. three logical columns); **max-width** and **responsive collapse** (e.g. single column on narrow hosts) must be defined in UI/CSS spec so content is not clipped (see prior design discussion: widen popup vs stack). |
| **States** | **Loading**, **error**, **empty** (no buckets), and **partial data** must be explicit in the React UI. |

**Migration:** until the API and React popup ship, existing HTML popup may remain as **fallback** behind a feature flag only if needed; contract assumes ** eventual replacement**.

---

## 10. Open items (to close in follow-up docs or tickets)

1. **Std dev:** population vs sample; behavior when **n &lt; 2**.
2. **Event time vs processing time** for bucket boundaries when ingest is delayed.
3. **Redis key catalog** and **TTL** table per entity/window.
4. **Exact OpenAPI** paths, authz (tenant/site/endpoint), and **rate limits** for trend-window reads.
5. **Field metadata catalog** for integer vs float vs exception (e.g. lat/lon).
6. **Downsampling** for 24h on dense metrics (if 288 points is too heavy for mobile).

---

## 11. Revision history

| Date | Change |
|------|--------|
| 2026-04-29 | Initial draft from product/architecture discussion (map popup React migration, 5m buckets, device + endpoint rollups, Redis + TS + workers, display rules). |
