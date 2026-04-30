# Trend & map implementation — phase status

This README tracks the **map popup + Redis/ Timescale trend pipeline** described in [`MAP_POPUP_TREND_WINDOWS_CONTRACT.md`](MAP_POPUP_TREND_WINDOWS_CONTRACT.md). It is the high-level companion to that contract (API shapes and keys stay normative there).

## Done (baseline through Phase 5)

| Phase | Summary |
|-------|---------|
| **1–2** | 5m buckets on Redis for **rdev → endpoint → site**; true multi-device endpoint/site aggregates; **stddev** when **n ≥ 2**; window keys `trend:window:{rdev\|endpoint\|site}:…:1h\|24h`. |
| **3** | Timescale hypertable **`trend_metric_bucket`** (`alembic_ts` **ts0003**); worker **UPSERT** after each LDS rollup when **`TIMESCALE_DATABASE_URL`** is set. |
| **4** | **`GET …/map-runtime/detail`** supports **LDS** types; **`trendScope`** drives **`trend_context`**; light markers expose **`endpoint_id`**; homogeneous **Supercluster** cohort opens popup with **endpoint**-scoped Redis trends. |
| **5** | Metric governance: **`TREND_METRIC_ALLOWLIST`** (env) + optional **`sites.trend_metric_allowlist`** (Alembic **0032**); filters **`GET /api/v1/trends/window`** and map detail KPI / **`trend_context.metricKeys`**. |

## Remaining (suggested order)

1. **Map object trends (data_object / result_object)** — **`trend_context`** + UI that uses **Timescale** `kpi_history_timescale` already returned on map detail (these kinds have no Redis `trend:window:*` series). *Replaces “Phase 7” in the original internal backlog naming.*
2. **Endpoint cohort hygiene** — stale or empty endpoint window buckets when member rdevs have no sample for a slot; optional Redis/Timescale reconcile or TTL strategy.
3. **Site rollup product policy** — when to default **`scope=site`** in UI vs endpoint vs device; align with ops dashboards.
4. **Dashboard-embedded map** — optional **widget binding** so trend keys shown on the map match the widget’s configured metric set (see [`DASHBOARD_WIDGET_CONTRACT.md`](DASHBOARD_WIDGET_CONTRACT.md)).
5. **Operational tooling** — job or admin path to **rebuild Redis** trend windows from **`trend_metric_bucket`** after cache loss.
6. **Contract polish** — OpenAPI for trends/map detail, optional **`maxPoints`** / downsampling for 24h, shared **field metadata** catalog for `formatMetricValue` (see contract §13).

## Migrations & env (quick reference)

| Piece | Where |
|-------|--------|
| **`trend_metric_bucket`** | Timescale: `services/api/alembic_ts/versions/0003_trend_metric_bucket.py` |
| **`sites.trend_metric_allowlist`** | Metadata: `services/api/alembic/versions/0032_site_trend_metric_allowlist.py` |
| **`TREND_METRIC_ALLOWLIST`** | API env; see `app/core/config.py` |

## Related docs

- [`MAP_POPUP_TREND_WINDOWS_CONTRACT.md`](MAP_POPUP_TREND_WINDOWS_CONTRACT.md) — v1.x revision history and backlog table §12.
- [`DASHBOARD_WIDGET_CONTRACT.md`](DASHBOARD_WIDGET_CONTRACT.md) — dashboard **`resolve-batch`** / layout workstream (separate from map popup trends).
