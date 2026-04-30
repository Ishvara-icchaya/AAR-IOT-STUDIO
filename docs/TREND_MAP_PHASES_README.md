# Trend & map implementation — phase status

This README tracks the **map popup + Redis/ Timescale trend pipeline** described in [`MAP_POPUP_TREND_WINDOWS_CONTRACT.md`](MAP_POPUP_TREND_WINDOWS_CONTRACT.md). It is the high-level companion to that contract (API shapes and keys stay normative there).

**Operations** (CLI, env, widget fields): see [`TREND_MAP_OPERATIONS.md`](TREND_MAP_OPERATIONS.md).

## Done (baseline through Phase 5)

| Phase | Summary |
|-------|---------|
| **1–2** | 5m buckets on Redis for **rdev → endpoint → site**; true multi-device endpoint/site aggregates; **stddev** when **n ≥ 2**; window keys `trend:window:{rdev\|endpoint\|site}:…:1h\|24h`. |
| **3** | Timescale hypertable **`trend_metric_bucket`** (`alembic_ts` **ts0003**); worker **UPSERT** after each LDS rollup when **`TIMESCALE_DATABASE_URL`** is set. |
| **4** | **`GET …/map-runtime/detail`** supports **LDS** types; **`trendScope`** drives **`trend_context`**; light markers expose **`endpoint_id`**; homogeneous **Supercluster** cohort opens popup with **endpoint**-scoped Redis trends. |
| **5** | Metric governance: **`TREND_METRIC_ALLOWLIST`** (env) + optional **`sites.trend_metric_allowlist`** (Alembic **0032**); filters **`GET /api/v1/trends/window`** and map detail KPI / **`trend_context.metricKeys`**. |

## Done (backlog follow-ups)

| Item | Summary |
|------|---------|
| **Map object trends** | **`trend_context.mode = map_object_timescale`** + **`MapObjectKpiTrendPopup`** (Timescale samples from detail). |
| **Endpoint cohort hygiene** | **Prune** stale **5m** slots on endpoint/site Redis series when rebuild finds **no** contributing member bucket. |
| **Site rollup default (widget)** | **`map_default_trend_scope`** / **`mapDefaultTrendScope`** on map widget **`data`** → detail **`trendScope`** for single **LDS** marker popups. |
| **Dashboard map ↔ metrics** | Popup passes widget **`kpi_fields`** as **`kpiKeys`** on map detail (and cluster popup). |
| **Redis rebuild** | CLI **`python -m app.commands.rebuild_trend_redis_cache`** + **`trend_redis_rebuild`** service. |
| **Downsampling** | **`GET /api/v1/trends/window?maxPoints=`** (1–500) uniform sample per metric series. |

## Remaining (lower priority)

1. **OpenAPI / field metadata catalog** — fuller schemas, **`formatMetricValue`** catalog (contract §13).
2. **Site rollup UX** — product defaults beyond the widget-level **`map_default_trend_scope`** (e.g. global operator preference).
3. **Dashboard resolve-batch** — full widget contract in [`DASHBOARD_WIDGET_CONTRACT.md`](DASHBOARD_WIDGET_CONTRACT.md) (separate track).

## Migrations & env (quick reference)

| Piece | Where |
|-------|--------|
| **`trend_metric_bucket`** | Timescale: `services/api/alembic_ts/versions/0003_trend_metric_bucket.py` |
| **`sites.trend_metric_allowlist`** | Metadata: `services/api/alembic/versions/0032_site_trend_metric_allowlist.py` |
| **`TREND_METRIC_ALLOWLIST`** | API env; see `app/core/config.py` |

## Related docs

- [`MAP_POPUP_TREND_WINDOWS_CONTRACT.md`](MAP_POPUP_TREND_WINDOWS_CONTRACT.md) — v1.x revision history and backlog table §12.
- [`TREND_MAP_OPERATIONS.md`](TREND_MAP_OPERATIONS.md) — CLI, env, widget binding fields.
- [`DASHBOARD_WIDGET_CONTRACT.md`](DASHBOARD_WIDGET_CONTRACT.md) — dashboard **`resolve-batch`** / layout workstream (separate from map popup trends).
