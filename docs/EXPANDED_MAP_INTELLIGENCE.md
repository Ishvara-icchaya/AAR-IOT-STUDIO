# Expanded Map Intelligence — engineering contract

Normative reference for the **split-view map intelligence** feature (fullscreen / “Intelligence view” + right panel), **server-side freshness**, **mobility**, **`scrubbed_events`** paths, and related APIs.  
Popup-only trends remain under [`MAP_POPUP_TREND_WINDOWS_CONTRACT.md`](MAP_POPUP_TREND_WINDOWS_CONTRACT.md).

---

## 1. Scope

| In scope | Out of scope (backlog / other docs) |
|----------|-------------------------------------|
| `GET …/map-runtime/intelligence/expanded` | Animated playback timeline UI (see §10) |
| `GET …/map-runtime/intelligence/path` | Path decimation for very dense fleets (§10) |
| Mobility + freshness rules in `map_intelligence_service` | Formal OpenAPI-only polish |
| Endpoint `auth_config` + LDS `display_json` overrides | Cluster popup wiring to same panel (§10) |
| Dashboard map widget UI: panel, polling, path overlay | Redefining gap *semantics* vs movement (§10) |

---

## 2. API URLs (v1)

Base prefix (as mounted today):

```text
/api/v1/dashboards/map-runtime
```

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/intelligence/expanded` | Site or endpoint roster: devices, mobility, freshness, aggregates, `trend_context`. |
| `GET` | `/intelligence/path` | Historical polyline + gaps from **`scrubbed_events`** for one **resolved device**. |

**Auth:** Same as other dashboard map routes — authenticated user, site must exist in tenant, **`user_may_access_site`**.  
**Errors:** `404` (site / endpoint / resolved device not found), `403` (site not permitted), `400` (unsupported `scope` on path).

---

## 3. Query parameters

### 3.1 `GET …/intelligence/expanded`

| Query | Required | Description |
|-------|----------|-------------|
| `site_id` | yes | Site UUID. |
| `endpoint_id` | no | When set, roster is limited to **`latest_device_state`** rows for that endpoint; endpoint summary block is populated for that endpoint. When omitted, **all** LDS rows for the site are considered (“Site (all endpoints)” summary). |
| `mode` | no | `runtime` \| `historical` (validated). Same payload shape today; UI uses `historical` for path-oriented workflows. Default `runtime`. |
| `page` | no | 1-based page index (default `1`, min `1`). |
| `limit` | no | Page size (default `25`, range `1`–`100`). |
| `kpiKeys` | no | Repeatable query key; drives **`latest_kpis`** per device, **`aggregate_kpis`**, and **`trend_context.metricKeys`**. Filtered by **site + global trend allowlist** (`filter_metric_keys_for_site`). |

### 3.2 `GET …/intelligence/path`

| Query | Required | Description |
|-------|----------|-------------|
| `site_id` | yes | Site UUID. |
| `entityId` | yes | **Resolved device** UUID (not LDS row id). Must belong to `site_id` and customer. |
| `scope` | no | Only **`resolved_device`** is supported; other values → `400`. |
| `from` | no | ISO-8601 lower bound on **`scrubbed_events.event_ts`**. |
| `to` | no | ISO-8601 upper bound on **`scrubbed_events.event_ts`**. |
| `expected_frequency_sec` | no | Used for **gap detection** (default `15`, clamped `5`–`3600`). |

---

## 4. Configuration keys (formalize here)

### 4.1 Endpoint — `endpoints.auth_config` (JSON)

Used by `read_endpoint_intelligence_defaults` and inherited by LDS rows on that endpoint unless overridden per device.

| Key (snake_case) | Key (camelCase alias) | Type | Meaning |
|------------------|----------------------|------|---------|
| `expected_ingest_interval_sec` | `expectedFrequencySec` | int | Nominal seconds between observations for **freshness** and gap threshold scaling. Default **15** if missing/invalid. Clamped to **5–3600**. |
| `mobility_type` | `mobilityType` | string | `static` \| `dynamic` only are honored; other values treated as “no endpoint default”. |

### 4.2 Device / LDS — `latest_device_state.display_json`

Nested object (either key accepted):

| Path | Meaning |
|------|---------|
| `map_intelligence` \| `mapIntelligence` | Object with optional overrides (see below). |

**Supported nested keys** (read in `build_device_intel_dict`):

| Key | Meaning |
|-----|---------|
| `mobilityType` \| `mobility_type` | `static` \| `dynamic` \| `unknown` — overrides endpoint default when valid. |
| `hasHeading` \| `has_heading` | boolean — contributes to **`has_heading`** when mobility is set from this block. |
| `expectedFrequencySec` \| `expected_frequency_sec` | int — per-device override of ingest interval (same clamp as endpoint). |

### 4.3 LDS — `latest_device_state.location_json` (heading)

First present numeric value wins (for **`heading_deg`** on markers and path points):

`heading_deg`, `heading`, `course`, `bearing`

### 4.4 LDS — `latest_device_state.location_json` (position for path)

**`scrubbed_events.location_json`** for path uses the same helper logic as lat/lon extraction:

- Latitude: `lat` or `latitude`
- Longitude: `lon`, `longitude`, or `lng`

Rows without both coordinates are skipped in the path builder.

---

## 5. Freshness rules (server-side)

**Reference time:** `now = UTC` at request handling.  
**Last observed:** `last_ingested_at` if set, else `last_event_ts`, else `latest_device_state.updated_at`.

Let `expected_sec` be the effective per-device interval (endpoint `auth_config` ± `display_json.map_intelligence` override, clamped).

Define:

- `stale_after = max(15, expected_sec * 3)` seconds  
- `offline_after = max(60, expected_sec * 10)` seconds  

**`freshness_status`:**

| Condition | Status |
|-----------|--------|
| No last observed timestamp | `unknown` |
| `age < 0` (clock skew) | `active` |
| `0 ≤ age < stale_after` | `active` |
| `stale_after ≤ age < offline_after` | `stale` |
| `age ≥ offline_after` | `offline` |

**Observable window** (expanded payload): `observable_window_sec = max(15, min_endpoint_expected_sec * 3)` across included devices (informative; not identical to per-device `stale_after` when devices differ).

---

## 6. Mobility rules

**Order of precedence** (`infer_mobility`):

1. **`display_json.map_intelligence`**: if `mobilityType` / `mobility_type` is `static`, `dynamic`, or `unknown`, use it; **`has_heading`** also considers `hasHeading` / `has_heading` or presence of heading in `location_json`.
2. Else **endpoint `auth_config`** `mobility_type` / `mobilityType` if `static` or `dynamic`.
3. Else **name heuristic** on `object_name` (substrings: `pole`, `sensor`, `camera`, `fixed`, `site asset`) → `static`.
4. Else if **heading** present in `location_json` → `dynamic` with `has_heading` true.
5. Else → `unknown`.

**Marker / map behavior (deck):** Short **heading tick** (yellow path) is drawn when **`map_profile === "fleet"`** *or* **`mobility_type === "dynamic"`** and **`heading_deg`** is a finite number.

---

## 7. Response shapes

### 7.1 `GET …/intelligence/expanded` (JSON object)

Top-level keys (all subject to additive evolution; do not rely on absence of new keys):

| Field | Type | Description |
|-------|------|-------------|
| `mode` | string | Echo of request `mode`. |
| `refresh_interval_sec` | int | `min` of devices’ expected intervals, clamped to **`[5, 300]`** — suggested client poll period. |
| `observable_window_sec` | int | `max(15, min_expected * 3)` as above. |
| `endpoint` | object \| null | Summary; `null` only on error paths. Site-wide: `id: null`, `name: "Site (all endpoints)"`. With `endpoint_id`: `id`, `name` (`endpoint_name`), `object_name`, `mobility_type_default`, `expected_frequency_sec`, counts. |
| `endpoint.device_count` | int | Number of LDS rows after filters. |
| `endpoint.active_count` | int | Count of devices with `freshness_status === "active"`. |
| `endpoint.stale_count` | int | … `"stale"`. |
| `endpoint.offline_count` | int | … `"offline"`. |
| `endpoint.unknown_count` | int | … `"unknown"`. |
| `aggregate_kpis` | object | Map metric key → **mean** of numeric `kpi_json` values across qualifying LDS rows (keys from allowlist-filtered list, max 12 keys processed). |
| `devices` | array | Page of device intelligence objects (see §7.3). |
| `devices_total` | int | Total devices before pagination. |
| `page`, `limit` | int | Echo pagination. |
| `trend_context` | object | `{ "site": { entityId, scope, metricKeys }, "endpoint"?: { … } }` — `endpoint` present only when `endpoint_id` was requested. `metricKeys` are allowlist-filtered. |
| `supports_historical_path` | bool | `true` when path API is available for scrubbed history. |

### 7.2 Device row (`devices[]`)

| Field | Type | Notes |
|-------|------|------|
| `scope` | string | Always `resolved_device` today. |
| `entityId` | string | **`resolved_device_id`**. |
| `source_type` | string | `latest_device_state`. |
| `source_id` | string | **`latest_device_state.id`** (for `/map-runtime/detail`). |
| `endpoint_id` | string | UUID string. |
| `display_name` | string | From `device_label` or `object_name`. |
| `mobility_type` | string | `static` \| `dynamic` \| `unknown`. |
| `has_heading` | bool | UI hint. |
| `expected_frequency_sec` | int | Effective interval after overrides. |
| `heading_deg` | number \| null | From `location_json`. |
| `first_observed_at` | string \| null | ISO from **`resolved_devices.created_at`** when present. |
| `last_observed_at` | string \| null | ISO from last-observed resolution. |
| `freshness_status` | string | `active` \| `stale` \| `offline` \| `unknown`. |
| `health_status` | string \| null | From LDS. |
| `latest_kpis` | object | Subset of `kpi_json` for requested keys (max 24 keys stored in row). |

### 7.3 `GET …/intelligence/path` (JSON object)

| Field | Type | Description |
|-------|------|-------------|
| `scope` | string | `resolved_device`. |
| `entityId` | string | Resolved device UUID. |
| `points` | array | `{ ts, lat, lng, heading_deg? }` ordered by time. |
| `polyline` | array | `[[lng, lat], …]` for MapLibre / deck **PathLayer**. |
| `gaps` | array | When consecutive point times exceed `max(30, expected_frequency_sec * 3)` seconds: `{ after_index, gap_sec, lat, lng }` (position taken from the **later** point). |
| `stale_segments` | array | `{ start_index, end_index }` pairs adjacent to each gap (diagnostic). |
| `first_observed_at`, `last_observed_at` | string \| null | From first/last **retained** path points. |
| `expected_frequency_sec` | int | Echo of query param used for gap math. |

**Implementation cap:** Up to **`4000`** `scrubbed_events` rows per request (`max_points` in service). Ordering: `event_ts` ascending.

---

## 8. Related APIs (unchanged but used together)

| API | Role |
|-----|------|
| `POST /dashboards/map-runtime/markers/query` | Live marker geometry for the map canvas. |
| `GET /dashboards/map-runtime/detail` | Per-marker detail when a device is selected in the panel. |
| `GET /trends/window` | Optional 1h trend summaries when diagnostics checkboxes are enabled in the panel. |

Trend metric keys in expanded responses honor **`TREND_METRIC_ALLOWLIST`** and **`sites.trend_metric_allowlist`** (see [`TREND_MAP_OPERATIONS.md`](TREND_MAP_OPERATIONS.md)).

---

## 9. Frontend behavior (dashboard map widget)

| Behavior | Description |
|----------|-------------|
| **Entry** | Header control **“Intelligence view”** opens fixed overlay with **map left**, **panel right** (see `index.css` `.dash-map-intel*`, `.dash-map-widget__expanded-split`). |
| **Endpoint scope** | Client passes **`endpoint_id`** derived as the **most frequent `endpoint_id`** among current light markers (`dominantEndpointId`); if none, expanded call is site-wide. |
| **Polling** | Panel refetches expanded data on an interval of **`refresh_interval_sec`** from the last response. |
| **Runtime / historical** | Toggle switches UI mode; **historical** enables **“Load 24h footprint”** which calls **`intelligence/path`** with `from`/`to` = last 24h and draws **footprint** (blue), **gap** markers (orange), **A/B** anchors (green/red) via **`setIntelligenceOverlay`**. |
| **Device list** | Client-side search over `display_name` and `entityId`; click loads **`map-runtime/detail`** for `latest_device_state` / `source_id`. |
| **Trend toggles** | Optional calls to **`GET /trends/window`** for endpoint and/or resolved device (1h, first metrics from widget KPI list or fallback `speed`). |
| **Cleanup** | Closing expanded view clears intelligence overlay on the deck instance. |

---

## 10. Known limits

| Limit | Detail |
|-------|--------|
| **Path row cap** | `4000` scrubbed rows; long windows or chatty devices may truncate without decimation. |
| **No playback scrubber** | Path is loaded as a full segment; no time-slider animation yet. |
| **Gap semantics** | Gaps are **time-only** (ingestion / reporting hiatus), not distinguished from “vehicle stopped but still ingesting”. |
| **Cluster popup** | Homogeneous cluster still uses the **small popup** + `TrendPopup`; not yet unified with expanded intelligence + same `trend_context` wiring. |
| **Site-wide endpoint** | Summary name is fixed label **“Site (all endpoints)”**; no multi-endpoint breakdown in one response. |
| **Detail preview** | Selected device detail is JSON-truncated in-panel for debugging; product may replace with structured fields. |

---

## 11. Follow-up backlog (engineering)

Track outside this contract until implemented:

1. **Animated playback slider** — drive map + panel from **`intelligence/path`** `points[]` / timestamps.  
2. **Path decimation** — server- or client-side when `scrubbed_events` volume exceeds **4000** or GPU budget.  
3. **Document `auth_config` / `display_json` in ops** — surface keys in [`MANAGE_DEVICES_AND_INGEST_PIPELINES.md`](MANAGE_DEVICES_AND_INGEST_PIPELINES.md) or site runbooks.  
4. **Cluster / endpoint popup** — reuse **`intelligence/expanded`** + **`TrendPopup`** / `trend_context` for homogeneous clusters.  
5. **Historical gap semantics** — separate **ingest gap** vs **geostationary segment** (e.g. speed threshold, duplicate positions).  
6. **OpenAPI** — publish schemas for expanded + path under dashboard map tags.

---

## 12. Source of truth (code)

| Area | Path |
|------|------|
| Service | `services/api/app/services/map_intelligence_service.py` |
| Routes | `services/api/app/api/v1/map_runtime.py` |
| LDS marker enrichment | `services/api/app/services/dashboard_live.py` (`build_map_marker_for_source`) |
| Light marker passthrough | `services/api/app/services/map_runtime_service.py` (`map_marker_to_light`) |
| Panel + API client | `services/frontend/src/components/dashboard/map/MapIntelligencePanel.tsx`, `services/frontend/src/api/dashboard.ts` |
| Deck overlays | `services/frontend/src/components/dashboard/map/deckOverlaySiteMap.ts` |
| Freshness tests | `services/api/tests/test_map_intelligence.py` |

---

## 13. Revision history

| Date | Change |
|------|--------|
| 2026-04-30 | Initial contract: APIs, config keys, freshness/mobility rules, response shapes, UI behavior, limits, backlog. |
