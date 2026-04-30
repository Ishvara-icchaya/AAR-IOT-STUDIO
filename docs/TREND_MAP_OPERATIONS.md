# Trend & map — operations guide

Companion to [`TREND_MAP_PHASES_README.md`](TREND_MAP_PHASES_README.md) and [`MAP_POPUP_TREND_WINDOWS_CONTRACT.md`](MAP_POPUP_TREND_WINDOWS_CONTRACT.md). This file is for **operators and integrators** (env vars, CLI, widget JSON).

## Environment variables

| Variable | Service | Purpose |
|----------|---------|---------|
| **`TREND_METRIC_ALLOWLIST`** | API | Comma/whitespace-separated metric keys allowed in **`GET /api/v1/trends/window`** and map detail **`trend_context`** / KPI lists. Empty = no global filter. |
| **`TIMESCALE_DATABASE_URL`** | API, workers | Timescale connection; required for **`trend_metric_bucket`** writes and rebuild CLI reads. |
| **`REDIS_URL`** | API, workers | Hot cache for **`trend:*`** series and **`trend:window:*`** windows. |

Per-site override: column **`sites.trend_metric_allowlist`** (metadata DB). See Alembic **`0032_site_trend_metric_allowlist`**.

## Rebuild Redis trend cache from Timescale

After Redis data loss, repopulate **`trend:rdev|endpoint|site:…:5m`** and **`trend:window:…`** from **`trend_metric_bucket`** for one site:

```bash
cd services/api
PYTHONPATH=. python -m app.commands.rebuild_trend_redis_cache --site-id <SITE_UUID> --hours 26
```

- **`--hours`**: lookback window (default **26**, max **168**). Rows are grouped by **(scope, entity_id, metric_key)** and written as sorted JSON arrays, matching the worker’s bucket shape.
- Exit code **0** on success; prints the number of distinct **5m series** keys updated.
- Requires network access to Timescale and Redis from the host running the command (same URLs as the API).

Implementation: **`app/services/trend_redis_rebuild.py`**, CLI: **`app/commands/rebuild_trend_redis_cache.py`**.

## API: downsampling trend responses

**`GET /api/v1/trends/window`** accepts optional **`maxPoints`** (1–500). When set, each metric’s bucket list is **uniformly downsampled** before return (helps thin clients for **24h** windows). OpenAPI reflects the parameter on the trends route.

## Dashboard map widget: binding alignment

Map block **`data`** may include:

| Field | Type | Purpose |
|-------|------|---------|
| **`kpi_fields`** | string[] | Already used for marker query; now also sent as **`kpiKeys`** on map **detail** fetch so popup KPIs / **`trend_context.metricKeys`** match the widget. |
| **`map_default_trend_scope`** (or camelCase **`mapDefaultTrendScope`**) | `resolved_device` \| `endpoint` \| `site` | For **single-marker** **LDS** popups, sets initial **`trendScope`** on detail (cluster endpoint popup still forces **endpoint**). |

Use **`map_default_trend_scope: "site"`** when the map should default to site-level Redis rollups for operators (product policy); leave unset for per-device trends.

## Worker: stale cohort buckets

When no resolved device contributes to an endpoint (or endpoint to site) for a given **5m** slot, the rollup now **removes** that slot from the endpoint/site series if it was present (**stale cohort hygiene**), then refreshes window keys. Logic: **`remove_bucket_for_time`** in **`services/workers/app/trend_window_rollup.py`**.
