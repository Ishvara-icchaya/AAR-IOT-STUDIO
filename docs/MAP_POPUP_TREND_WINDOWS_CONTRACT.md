# Map popup & trend windows — architecture contract (v1.5)

This document is the **engineering-ready contract** for map marker detail UX, **metadata-driven** numeric formatting, **5-minute trend buckets** (resolved device, endpoint, and site), **moving windows** (1h / 24h), **Redis hot cache**, **durable storage**, **workers**, and the **React MapLibre popup**. OpenAPI remains the normative API spec once implemented.

**Implementation context:** Today the map uses **HTML string** popups (`MapWidget` → `popupContentFromDetail`). Target: **no HTML string popups** for production detail — **one React root per open popup**, **lazy** trend UI, **unmount on close**.

---

## 1. Goals

1. **Operator questions:** “What happened to this **resolved device**, **endpoint**, or **site** over the **last hour** or **day**?” — with readable numbers and **trend** context.
2. **Aggregations:** Per **5-minute** bucket: **avg, min, max, stddev, n, is_partial** (full set returned by default from API; see §8).
3. **Rollup surfaces:**
   - **`resolved_device`** — canonical series for one asset.
   - **`endpoint`** — cohort under an endpoint (scoped through **tenant/site** context when endpoint IDs are not globally unique).
   - **`site`** — site-level rollup where product requires fleet-by-site views.
4. **Performance:** Popup reads hit **Redis / narrow TS queries**; **no raw recomputation** on popup open.
5. **Presentation:** **Metadata-driven** formatting (§3), not value guessing.

---

## 2. Definitions

| Term | Meaning |
|------|--------|
| **`entityId`** | Canonical UUID (or stable string) for the **scope** in API and UI — **never** a generic `id` query param. |
| **Bucket** | Fixed **300s** interval; **immutable once closed**. Open bucket = **`is_partial: true`**. |
| **Moving window** | **Read** of stored buckets from **`as_of`** backward: **1h → 12 buckets**, **24h → 288 buckets** at 5m cadence (see §6). |
| **Trend** | Time-ordered bucket stats for sparkline / small chart. |
| **Popup shell** | MapLibre `Popup` DOM host with **one React root**, lazy trend bundle, **unmount on close**. |

---

## 3. Numeric presentation (UI contract)

Implement **`formatMetricValue(value, fieldMeta)`** (or equivalent) as a **presentation-layer** helper only.

| Input | Display |
|-------|--------|
| **integer** (`fieldMeta.type === "integer"`) | Whole number, **no** decimals. |
| **float** (`type === "float"`, optional `decimals`, default **2**) | Rounded to **2** decimals. |
| **string / code / id / enum** | Unchanged. |
| **null / undefined** | **`—`** |

**Field metadata** drives behavior (example):

```json
{
  "key": "speed",
  "label": "Speed",
  "type": "float",
  "unit": "mph",
  "decimals": 2
}
```

Coordinates / special fields: exceptions live in the **field metadata catalog** (see §12).

---

## 4. Bucket schema (durable + API series point)

Store **5-minute** buckets at **`resolved_device`**, **`endpoint`**, and **`site`** levels (same schema shape; rollup pipeline defines how site buckets aggregate).

**Logical record:**

```json
{
  "bucket_start": "2026-04-30T10:00:00Z",
  "bucket_size_sec": 300,
  "metric_key": "speed",
  "n": 42,
  "sum": 2140.5,
  "sumsq": 112340.9,
  "min": 38.2,
  "max": 61.7,
  "avg": 50.96,
  "stddev": 4.83,
  "is_partial": false
}
```

**Rules:**

- **Authoritative** for recomputation: **`n`, `sum`, `sumsq`, `min`, `max`**. **`avg`** is **denormalized** at write time (`sum / n`) for read optimization; if corrected, rederive from **`sum` / `n`**.
- **`stddev`:** compute and **return only when `n >= 2`**; otherwise omit or `null` (UI shows **—**).
- **`is_partial`:** `true` for the **open** bucket until closed.

---

## 5. Moving windows

- **Do not** rescan raw telemetry when the popup opens. **Query stored buckets** only.
- **1h:** last **12** five-minute buckets ending at **`as_of`** (inclusive of open bucket per §7).
- **24h:** last **288** buckets at 5m cadence.
- **`as_of`:** default **now**; optional ISO timestamp for **frozen / debug / export** (`TrendPopupProps.asOf`, API param when added).

**Partial bucket (default):**

| Mode | Partial bucket |
|------|----------------|
| **Live popup / default API** | **Include** open/current partial bucket. |
| **Historical / export** (later) | May **exclude** partial bucket; document per API or `?includePartial=false`. |

---

## 6. Worker / rollup pipeline

**Flow:**

```
scrubbed telemetry sample
        → update resolved_device 5m bucket
        → update endpoint 5m rollup
        → update site 5m rollup (if enabled for metric)
        → write durable bucket store (Timescale = source of truth)
        → write / refresh Redis hot cache (window + series keys)
```

**Implemented (workers):** `worker-map-aggregator` consumes **`latest_device_state.updated`**, maintains **`trend:{rdev|endpoint|site}:…:5m`** bucket arrays (fields **`n`, `sum`, `sumsq`, `min`, `max`, `avg`, `stddev`, `is_partial`**, `bucket_start`, `bucket_size_sec`), slices **`trend:window:*:1h|24h`** from those series, and **rebuilds endpoint and site** windows by **aggregating** all member rdev / endpoint buckets for the same 5m slot (not a single-device mirror). TTLs: **5m series → 26h**, **1h window → 90m**, **24h window → 26h** (§8).

**Durability (Timescale, v1.4):** Hypertable **`trend_metric_bucket`** (`alembic_ts` revision **ts0003**) stores one UPSERTed row per **`(bucket_time, scope, entity_id, metric_key)`** for scopes **`rdev`**, **`endpoint`**, **`site`**, aligned with the same bucket stats as Redis. Workers call **`upsert_trend_metric_bucket`** after each successful LDS rollup (requires **`TIMESCALE_DATABASE_URL`**). Enables historical queries, backfill, and future **Redis rebuild from Timescale** without changing the hot-path Redis contract.

**Redis holds (conceptual):** materialized **5m series** slices and/or **pre-merged window** blobs for fast popup reads — exact keys in §8.

---

## 7. Trend API (canonical)

**Single read endpoint** (OpenAPI to follow):

```http
GET /api/v1/trends/window?scope=resolved_device|endpoint|site&entityId=<uuid>&metrics=speed,temperature&window=1h|24h&bucket=5m
```

- **`entityId`:** required; **never** use a generic `id` param name.
- **`metrics`:** comma-separated metric keys.
- **`window`:** `1h` | `24h`.
- **`bucket`:** default **`5m`**; reserved for future cadence options.
- **`stats`:** **omit** by default — response includes **full** bucket stats: **`avg`, `min`, `max`, `stddev` (when defined), `n`, `is_partial`**. Optional **`stats=`** projection may be added later for bandwidth only.

**Example response:**

```json
{
  "scope": "resolved_device",
  "entityId": "b3e4f5a0-…",
  "window": "1h",
  "bucket": "5m",
  "as_of": "2026-04-30T12:00:00Z",
  "series": {
    "speed": [
      {
        "ts": "2026-04-30T10:00:00Z",
        "avg": 51.2,
        "min": 44.1,
        "max": 59.7,
        "stddev": 3.4,
        "n": 36,
        "is_partial": false
      }
    ]
  }
}
```

**Authz:** trend reads use the **same authorization model** as dashboard runtime reads: **tenant, site, endpoint, resolved_device**, and **metric visibility** policy. **`scope=endpoint` (and `site`)** must resolve through **tenant/site** (and object binding if required) when endpoint IDs are not globally unique.

---

## 8. Redis key strategy & TTL

**Key patterns** (prefix `trend:`; **`rdev`** = resolved device):

| Pattern | Purpose |
|---------|--------|
| `trend:rdev:{resolved_device_id}:{metric_key}:5m` | Device 5m series / bucket materialization |
| `trend:endpoint:{endpoint_id}:{metric_key}:5m` | Endpoint 5m rollup |
| `trend:site:{site_id}:{metric_key}:5m` | Site 5m rollup (when used) |
| `trend:window:rdev:{resolved_device_id}:{metric_key}:1h` | Hot **1h** window for device + metric |
| `trend:window:rdev:{resolved_device_id}:{metric_key}:24h` | Hot **24h** window |
| `trend:window:endpoint:{endpoint_id}:{metric_key}:1h` | Hot **1h** endpoint window |
| `trend:window:endpoint:{endpoint_id}:{metric_key}:24h` | Hot **24h** endpoint window |
| `trend:window:site:{site_id}:{metric_key}:1h` | Hot **1h** site window (when used) |
| `trend:window:site:{site_id}:{metric_key}:24h` | Hot **24h** site window (when used) |

**TTL (keep slack for clock skew, ingest lag, late samples):**

| Key class | TTL |
|-----------|-----|
| **1h window** cache | **90 minutes** |
| **24h window** cache | **26 hours** |

---

## 9. MapLibre React popup (UI contract)

**Rules:**

1. **One React root** per **open** popup instance.
2. **Lazy-load** the trend UI: e.g. `const TrendPopup = React.lazy(() => import("./TrendPopup"));`
3. **Unmount** the root **on popup close** (avoid leaks / duplicate listeners).
4. **Do not** use **HTML string** popups for production trend detail.

**`TrendPopupProps` (thin client):**

```ts
type TrendPopupProps = {
  scope: "resolved_device" | "endpoint" | "site";
  entityId: string;
  title: string;
  metricKeys: string[];
  defaultWindow: "1h" | "24h";
  asOf?: string;
};
```

The popup **only** calls **`GET /api/v1/trends/window`**; it **does not** recompute rollups locally.

**Cluster / endpoint marker:** feature state (or equivalent) must pass a **defined contract**, e.g.:

```json
{
  "scope": "endpoint",
  "entityId": "<endpoint-uuid>",
  "metricKeys": ["speed", "temperature"]
}
```

**Map behavior:** device marker → **`scope=resolved_device`**; cluster / endpoint marker → **`scope=endpoint`** (or **`site`** when applicable).

**In-popup UX (product):** default **1h**; toggle **1h / 24h**; show **avg, min, max, stddev**; chart = **5m** bucket trend; **summary row** = window-level aggregates / latest as specified in UI spec.

**Layout:** multi-column / max-width / responsive collapse per separate UI note (avoid clipped content).

---

## 10. Storage layers

| Layer | Role |
|-------|------|
| **Timescale (or chosen TS store)** | **Source of truth** for bucket rows; backfill and recomputation. |
| **Redis** | **Fast runtime** layer for window/series reads; TTLs in §8. |
| **Postgres** | Metadata / policy only unless buckets are explicitly mirrored. |

---

## 11. Implementation order (suggested)

1. **`formatMetricValue` + field metadata** wiring (shared formatter).
2. **Bucket schema / migrations** (durable store).
3. **Worker** — 5m aggregation pipeline (device → endpoint → site → durable → Redis).
4. **Redis helpers** — keys + TTL + invalidation rules.
5. **`GET /api/v1/trends/window`** — authz, validation, series assembly.
6. **MapLibre** — replace HTML popup with **React root** + lazy **`TrendPopup`**.
7. **Tests** — e.g. truck **speed** 1h / 24h; extend to other metrics via metadata.

---

## 12. Product & security backlog (post–MVP)

Review queue (prioritize after Redis worker + UI polish):

| Priority | Item |
|----------|------|
| 1 | **Metric visibility policy** — restrict trend reads to metrics the tenant/site allows (beyond entity ownership). |
| 2 | **Dashboard widget binding permissions** — align trend keys with widget-bound metric sets where applicable. |
| 3 | **Site-level metric allowlist** — optional cap list per site/customer. |
| 4 | **Cluster / endpoint map popup** — pass feature state `{ scope: "endpoint", entityId, metricKeys }` and reuse the same React popup shell as resolved_device. |
| 5 | **Endpoint cohort edge cases** — e.g. stale endpoint windows if all rdevs lack a bucket for a slot (no delete pass yet). |
| 6 | **Site rollup** — Redis `trend:site:*` is written by worker; **policy** / UX for `scope=site` may still evolve. |
| 7 | **Durable Timescale bucket table** — source of truth + backfill; Redis remains hot cache. |

Current slice: **site + entity ownership** auth on `GET /trends/window` is acceptable until the policy layer above lands.

---

## 13. Open items (schema / API details)

1. **Std dev:** finalize **population vs sample** variance in schema; document formula next to `sumsq`.
2. **Event time vs processing time** for bucket boundaries under ingest delay.
3. **OpenAPI** — paths, errors, rate limits, `includePartial` for historical mode.
4. **Field metadata catalog** — per-metric `type`, `decimals`, geo exceptions.
5. **Downsampling** for 24h on constrained clients (optional future `?maxPoints=`).

---

## 14. Final engineering direction (summary)

Implement as:

- **Metadata-driven** numeric formatting (`formatMetricValue` + `fieldMeta`).
- **5-minute immutable buckets** at **`resolved_device`**, **`endpoint`**, and **`site`**.
- **Full bucket stats** in API by default; optional **`stats=`** projection later.
- **`avg` denormalized**; **`n`, `sum`, `sumsq`, `min`, `max`** authoritative.
- **Partial bucket included** for live views by default.
- **Redis window cache** with **90m / 26h** TTL slack.
- **Single authorized** **`GET /api/v1/trends/window`** with **`entityId`** + **`scope`**.
- **React lazy-loaded** MapLibre popup; **canonical naming** to avoid identity / cache / UI drift.

---

## 15. Revision history

| Date | Change |
|------|--------|
| 2026-04-29 | Initial draft (HTML → React popup, buckets, Redis, workers, display rules). |
| 2026-04-29 | **v1.1** — `entityId` / `scope` API; `rdev` Redis keys; full default stats; `avg` denormalized; partial bucket default; TTL rationale; authz alignment; `TrendPopupProps` + MapLibre rules; cluster feature-state; implementation order; site rollup keys. |
| 2026-04-29 | **v1.2** — Backlog table (metric visibility, bindings, allowlist, cluster popup, cohort/site rollup, Timescale); worker populates `trend:window:rdev|endpoint` from LDS; popup empty-state copy. |
| 2026-04-29 | **v1.3** — Worker: **5m series** keys + **true endpoint/site aggregation** from all cohort members; **sum/sumsq/stddev** on rdev merge; API normalizes **`avg`/`stddev`** from `sum`/`sumsq` when needed. |
| 2026-04-30 | **v1.4** — Timescale **`trend_metric_bucket`** hypertable + worker UPSERT after each LDS metric rollup (Phase 3 durability). |
| 2026-04-30 | **v1.5** — Map detail for **LDS** + **`trendScope`** query; homogeneous **Supercluster** cohort → popup with **`trend_context.scope=endpoint`**; light markers carry **`endpoint_id`** / **`resolved_device_id`**. |
