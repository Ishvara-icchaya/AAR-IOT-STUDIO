# Iteration log (append-only)

Purpose: durable trail of **what changed and why**, so work survives editor crashes and context loss.  
Convention: add a **new section at the top** (newest first) per session or logical batch of work.

---

## 2026-04-30 — Phase 5: Trend metric visibility (global + site allowlist)

- **Config:** **`TREND_METRIC_ALLOWLIST`** (`settings.trend_metric_allowlist`) — comma/whitespace-separated metric keys; empty = no global filter.
- **DB:** Alembic **`0032_site_trend_metric_allowlist`** — nullable **`sites.trend_metric_allowlist`** text; when set (including empty string) overrides global for that site; **NULL** inherits global env.
- **Policy:** `app/services/trend_metrics_policy.py` — **`filter_metric_keys_for_site`**, used by **`build_trends_window_response`** (returns empty **`series`** when no keys remain) and **`map_marker_detail`** (KPI keys + Timescale queries; empty list skips wide open history query).
- **Tests:** `tests/test_trend_metrics_policy.py`.

---

## 2026-04-30 — Phase 4: Map cluster endpoint trends + LDS map detail

- **API:** `GET /dashboards/map-runtime/detail` accepts **`latest_device_state`** and **`device_state`** (not only data/result objects). Optional **`trendScope`** (`resolved_device` \| `endpoint` \| `site`) selects **`trend_context`** for LDS popups (endpoint cohort vs single rdev vs site rollup).
- **Map runtime:** `map_marker_to_light` includes **`endpoint_id`** / **`resolved_device_id`** so cluster logic can detect homogeneous LDS cohorts.
- **Frontend:** `MapPointVM` / **`MarkerLike`** carry endpoint ids; **`deckOverlaySiteMap`** exposes **`getClusterLeaves`**; **`MapWidget`** opens marker popup with **`trendScope=endpoint`** when a cluster’s leaves share one **`latest_device_state`** endpoint; otherwise keeps zoom-to-expand. **`getMapObjectDetail`** / **`MapMarkerPopupRoot`** / **`mountMapMarkerPopup`** pass **`trendScope`** through.

---

## 2026-04-30 — Phase 3: `trend_metric_bucket` Timescale durability

- **Timescale:** New hypertable **`trend_metric_bucket`** (`services/api/alembic_ts/versions/0003_trend_metric_bucket.py`, revision **ts0003**) — **`bucket_time`**, **`customer_id`**, **`site_id`**, **`scope`** (`rdev` \| `endpoint` \| `site`), **`entity_id`**, **`metric_key`**, stats **`n`/`sum`/`sumsq`/`min`/`max`/`avg`/`stddev`/`is_partial`**, **`updated_at`**; composite PK for **`ON CONFLICT` UPSERT**; indexes for customer/site and scope/entity/metric time-range queries.
- **Workers:** `map_aggregator_db.upsert_trend_metric_bucket`; `apply_trend_rollups_from_lds_row` persists **rdev**, **endpoint**, and **site** bucket rows after each successful Redis rollup when **`TIMESCALE_DATABASE_URL`** is set (failures logged; Redis path unchanged).
- **Docs:** `MAP_POPUP_TREND_WINDOWS_CONTRACT.md` **v1.4** (durability paragraph + revision row).

---

## 2026-04-29 — Trend rollup: rdev 5m series + true endpoint/site aggregates

- **Workers:** Rewrote `trend_window_rollup.py` — **`trend:rdev|endpoint|site:{id}:{metric}:5m`** JSON arrays with **n, sum, sumsq, min, max, avg, stddev, is_partial**; **endpoint** and **site** rebuilt by **merge_bucket_stats** over all **`resolved_devices`** on the endpoint / all **`endpoints`** on the site; **window** keys sliced from 5m data (`slice_window` 1h / 24h) with TTL **90m / 26h**; **5m series TTL 26h**. `map_aggregator_db`: **`last_event_ts`/`updated_at`** on LDS fetch; **`fetch_resolved_device_ids_for_endpoint`**, **`fetch_endpoint_ids_for_site`**. `map_object_aggregator` calls **`apply_trend_rollups_from_lds_row`**. Lazy-import DB helpers so unit tests run without `psycopg2`.
- **API:** `trends_window_service._normalize_bucket` — derive **`avg`** from **sum/n**; **`stddev`** from **sumsq** when missing and **n ≥ 2**.
- **Docs:** `MAP_POPUP_TREND_WINDOWS_CONTRACT.md` **v1.3** (worker behavior + backlog tweak).

---

## 2026-04-29 — Trend Redis worker (LDS) + popup empty state + contract backlog

- **Workers:** `trend_window_rollup.py` — upserts **5m-floor** buckets into **`trend:window:rdev:{id}:{metric}:1h|24h`**, mirrors JSON to **`trend:window:endpoint:…`** (interim; cohort merge later); TTL **5400s** / **93600s**. **`map_object_aggregator`** now consumes **`latest_device_state.updated`** (`KAFKA_LATEST_DEVICE_STATE_TOPIC`) and loads LDS via **`fetch_latest_device_state_row`** (`map_aggregator_db.py`).
- **Frontend:** `TrendPopup` — when all requested metrics return empty series, show **“No trend data available yet.”** (not an error); per-metric empty uses same copy.
- **Docs:** `MAP_POPUP_TREND_WINDOWS_CONTRACT.md` **v1.2** — §12 product/security backlog (metric visibility, bindings, allowlist, cluster popup, cohort/site rollup, Timescale); §6 worker note; revision history.
- **Tests:** `services/workers/tests/test_trend_window_rollup.py` (floor, upsert, trim).

---

## 2026-04-29 — Map widget: 320px floor + 16:9 aspect preview

- **Frontend:** `MapWidget` adds **`widget--map`** (with existing `dash-widget--map`); map container styles — **`min-height: 320px`** on non-expanded map widget, **`aspect-ratio: 16 / 9`** on single-map wrap and enterprise map canvas; full-width single map (replacing 50% centered strip); live/page-card overrides stop forcing a clamped map height so the aspect box drives layout; **`:has`** rule on **`.dash-col--slot-data`** when the stack contains a map so the column floor is **max(slot min, 320px)** (`dashboardWidgetFrame.css`).
- **Intent:** Map never compresses below a usable preview; grid **row/column grows vertically**; spanning extra rows remains a **layout/editor** choice.

---

## 2026-04-29 — Trends window API + React map popup (contract slice 1)

- **API:** `GET /api/v1/trends/window` (`scope`, `entityId`, `site_id`, `metrics`, `window`, `bucket=5m`, optional `as_of`) — site auth aligned with map runtime; reads Redis keys per `docs/MAP_POPUP_TREND_WINDOWS_CONTRACT.md` (`trend:window:…`); `app/services/trend_redis_contract.py`, `trends_window_service.py`, `app/api/v1/trends.py`, router mount.
- **Map detail:** `trend_context` on `latest_device_state` / `device_state` detail; LDS markers include `resolved_device_id` + `endpoint_id` (`map_runtime_service`, `dashboard_live`).
- **Frontend:** `formatMetricValue` + `types/trends.ts`, `getTrendsWindow`, lazy `TrendPopup`, `MapMarkerPopupRoot` + `mountMapMarkerPopup` (one `createRoot` per popup, unmount on close); `MapWidget` no longer uses HTML string popups for marker detail.
- **Tests:** `services/api/tests/test_trends_window.py` (OpenAPI path + bucket normalization). **Follow-ups:** rollup worker writing `trend:window:*` JSON; Timescale bucket store; optional `includePartial`; cluster popup `TrendPopup` wiring.

---

## 2026-04-29 — MAP_POPUP_TREND_WINDOWS_CONTRACT v1.1 (engineering-ready)

- **Docs:** Updated `docs/MAP_POPUP_TREND_WINDOWS_CONTRACT.md` to **v1.1** — canonical **`entityId`** + **`scope`** (`resolved_device` \| `endpoint` \| `site`), **`GET /api/v1/trends/window`** query shape, **full default bucket stats** (`avg` denormalized; authoritative `n`/`sum`/`sumsq`/`min`/`max`), **partial bucket included** for live reads, **Redis key table** (`trend:rdev:…`, `trend:window:…`, site variants), **TTL slack** (1h window → 90m, 24h → 26h), **authz** aligned with dashboard runtime, **`TrendPopupProps`** + **MapLibre** rules (one root, lazy, unmount, no HTML strings), **cluster feature-state** JSON contract, implementation order.
- **Intent:** Lock contract so implementation avoids identity, cache, and UI drift; OpenAPI and code still to follow.

---

## 2026-04-29 — Doc contract: map popup trends & trend windows

- **Docs:** Added `docs/MAP_POPUP_TREND_WINDOWS_CONTRACT.md` — draft architecture contract for **5m buckets**, **device + endpoint rollups**, **1h/24h moving windows**, **Redis + durable TS + workers**, **numeric display rules** (integers vs floats), **React + lazy map popup**, and illustrative **trend-window API** shape.
- **Intent:** Record agreed direction before implementation; follow-ups listed for std dev, event time, Redis key catalog, OpenAPI, field metadata.

---

## 2026-04-29 — Dashboard screenshot: walk clone computed styles for oklab

- **Frontend:** `DashboardLiveToolbar.tsx` — after clone stylesheet + inline strip, walk capture subtree and for each `getComputedStyle` declaration whose **value** contains oklab/oklch/color-mix/lab/lch, apply `!important` rgb fallbacks (color, background, borders, shadows, SVG fill/stroke, etc.) so html2canvas `CSSParsedDeclaration` no longer hits unsupported parsers.

---

## 2026-04-29 — Dashboard screenshot: strip oklab gradients in html2canvas clone

- **Frontend:** `DashboardLiveToolbar.tsx` — `onclone` now tags the cloned capture root and injects rules to remove **all** `background-image` / `border-image` / masks in that subtree (html2canvas cannot parse `oklab` inside `linear-gradient` stops); strip inline `style` attributes that mention oklab/oklch/color-mix on the clone.

---

## 2026-04-29 — Dashboard live screenshot: html2canvas hardening

- **Frontend:** `DashboardLiveToolbar.tsx` — safer `backgroundColor` for canvas (avoid oklch/lab from `getComputedStyle`); `foreignObjectRendering: false`, `allowTaint: false`, capped scale; `onclone` injects simplified solid backgrounds for `.dashboard-runtime` / `.dash-wf` (strip color-mix / pseudo grid); `ignoreElements` skips MapLibre canvas and controls (avoids tainted canvas / WebGL issues); separate `toDataURL` try/catch with **SecurityError** messaging; `console.error` for real failures (previous copy always blamed downloads).

---

## 2026-04-29 — README: iteration log for crash recovery

- **Docs:** `README.md` — new section **Iteration log (recover from crashes)** pointing to `docs/ITERATION_LOG.md` and describing prepend-after-substantive-work discipline so work survives session or machine failures.

---

## 2026-04-29 — Dashboard runtime visual layer (Grafana-style shell + cards)

- **Frontend:** `dashboard-runtime.css` — scoped `.dashboard-runtime` operational background (radials + optional grid), 24px padding, 16px row gap for fit-page, beveled `.dash-wf` cards under `.dashboard-widget-cell`, preview-only hover on `--builder`. Light theme softening via `:root[data-theme="light"]`.
- **Components:** `DashboardRuntimeShell` gains `variant` (`live` | `builder` | `enterprise`); `DashboardLiveRenderer` infers variant from `layoutDensity` / `enterpriseMode` with optional `runtimeVariant` override; imports runtime CSS.
- **CSS:** `dashboard-widget-contract.css` keeps cell/body sizing; frame border/gradient moved to runtime layer to avoid double chrome.
- **Intent:** One shared visual layer for `/dashboard/:id/live`, preview, and enterprise resolved renderer without `/dashboard2` or duplicate widget headers.

---

## 2026-04-29 — Stop tracking local editor-only rules in git

- **Removed:** Tracked `iteration-log` rule file that lived under a local-only editor config directory; that directory is now listed in `.gitignore` so it is not re-committed.
- **Docs:** Clarified iteration-log and dashboard contract wording (pagination tokens vs other meanings).

---

## 2026-04-29 — Repo hygiene: Dashboard2 removal committed + contract doc on branch

- **Chore:** Staged and committed remaining Dashboard2 deletes (frontend `dashboard2/`, `featureFlags`, `dashboard2` lib/pages/types), API `dashboard2_demo_seed` + test + `main.py` wiring, docs `DASHBOARD2_*`, README / `platform-api` README trims, frontend `package.json` / lockfile (drop `react-grid-layout`).
- **Added:** `docs/DASHBOARD_WIDGET_CONTRACT.md`, `scripts/smoke-dashboard-api.sh` (were untracked).
- **Intent:** Clean working tree on `v2-endpoints-rebuild` for push/upload.

---

## 2026-04-29 — Dashboard widget runtime: API + client + layout (phase 1)

- **API:** `app/core/dashboard_widget_types.py` (canonical `widgetType`, `block.type` map, sentinels); `app/schemas/dashboard_widget_runtime.py` (camelCase envelope DTOs); `GET /api/v1/dashboards/{id}/runtime-layout` via `dashboard_runtime_layout.py`; `POST /api/v1/dashboards/runtime/widgets/resolve-batch` via `dashboard_widget_resolve_batch.py` (delegates to existing `resolve_widget_data`, draft layout + `scopeHours`, `data_object` / invalid widget errors).
- **Frontend:** `types/dashboardWidgetRuntime.ts`, `getDashboardRuntimeLayout` / `postDashboardWidgetsResolveBatch` in `api/dashboard.ts`; `dashboard-widget-contract.css` + `dashboard-widget-cell` wrapper in `DashboardResponsiveGrid.tsx`.
- **Tests:** `tests/test_dashboard_widget_runtime.py` (OpenAPI paths + `canonical_widget_type`).
- **Follow-ups:** Wire live/preview pages to resolve-batch instead of embedded `/live` widgets; dedicated v2 builders per widget type; trend service; full `WidgetPayloadRenderer` switch.

---

## 2026-04-29 — Dashboard widget contract spec (consolidated doc)

- **Docs:** Added `docs/DASHBOARD_WIDGET_CONTRACT.md` — consolidated implementation contract for dashboard runtime (`runtime-layout` + `resolve-batch`), `DashboardWidgetPayload` envelope (camelCase), canonical `widgetType` / sentinel types (`invalid_widget_reference`, `unsupported`), opaque pagination cursors, backend widget builders, v2 read paths, legacy/rebind rules, layout/frame ownership, preview=live, and acceptance criteria.
- **Intent:** Single source of truth for multi-developer work on widget data contracts and dashboard cell rendering (no parallel data paths, no frontend inference on canvas).

---

## 2026-04-29 — Remove Dashboard 2.0 surface (frontend + demo seed + docs)

- **Frontend:** Removed `components/dashboard2/`, `pages/dashboard2/`, `lib/dashboard2/`, `types/dashboard2.ts`, `lib/featureFlags.ts`; restored `App.tsx`, `layouts/shell/navigation.ts`, `main.tsx`, `pages/dashboard/DashboardListPage.tsx` from pre–Dashboard2 baseline (`0cbf641`). Dropped `react-grid-layout` / `react-resizable` dependencies (only used by Dashboard2).
- **API:** Removed `dashboard2_demo_seed.py` and `test_dashboard2_demo_seed.py`; removed startup call from `services/api/app/main.py`.
- **Docs:** Deleted `docs/DASHBOARD2_REVIEW.md`, `docs/DASHBOARD2_CSS_BOUNDARIES.md`; trimmed `README.md` Dashboard 2.0 phased-rollout section; reset `services/platform-api/README.md` stub.
- **Intent:** Undo the Dashboard2 UI, routes, nav, demo seed, and related documentation while keeping endpoint-group / legacy dashboard APIs and `api/dashboard.ts` client helpers unchanged.

---

## 2026-04-29 — Dashboard2 layout containment (demo): CSS + map defaults

- `dashboard2.css`: grid items `box-sizing: border-box`, removed forced `min-height` on RGL; card `width: 100%`; map canvas explicit `width/height: 100%` on absolute layer.
- `BINDING_HINT` copy: **Configure binding to preview this widget.**
- `location_heading_map` default grid **h=9**, **minH=6** (registry + `migrateLegacyDashboardToGrid`).

---

## 2026-04-29 — Dashboard2 demo-safe layout, MapLibre resize, incomplete binding guard

- `services/frontend/src/main.tsx`: import `react-grid-layout` and `react-resizable` base CSS.
- `services/frontend/src/components/dashboard2/dashboard2.css`: grid shell `min-width/min-height` 0, `.react-grid-layout` / `.react-grid-item` fill rules for designer + preview + live; map/table/chart strict flex sizing; map canvas `absolute` in wrap.
- `LocationHeadingMapWidget`: `ResizeObserver` + rAF `resize()` on container / after data changes.
- `DashboardRuntimeDataProvider`: `isResolvedCollectionBindingReady` — skip fetch when site/endpoint/object missing; `bindingIncomplete` + friendly errors (no raw FastAPI JSON).
- `DashboardRuntimeGrid`: empty state for incomplete binding before loading/error.

Intent: stable grid handles, markers aligned to map viewport, clean demo without 422 spam.

---

## 2026-04-29 — Dashboard2 on by default (no env required)

- `services/frontend/src/lib/featureFlags.ts`: `DASHBOARD2_ENABLED` defaults **on** unless `VITE_DASHBOARD2_ENABLED=false`.
- `services/frontend/src/App.tsx`: `/dashboard2/*` routes always registered (no conditional mount).

Intent: ship list grid icon + review hub without requiring `VITE_DASHBOARD2_ENABLED=true`.

---

## 2026-04-29 — Dashboard list: Dashboard2 action icon (flag-gated)

- `services/frontend/src/pages/dashboard/DashboardListPage.tsx`: when `VITE_DASHBOARD2_ENABLED=true`, each row’s Actions column includes a **grid** link to `/dashboard2/:id/live` (tooltip “Dashboard 2.0 — live (grid)”).
- `docs/DASHBOARD2_REVIEW.md`: documented how to access Dashboard2 (flag, list icon, review hub, direct URLs).

Intent: match the requested entry point from **Dashboard → List** without changing legacy edit/live icons.

---

## 2026-04-29 — Dashboard API smoke script + review doc note

- Added `scripts/smoke-dashboard-api.sh`: login → `me` → list dashboards → get one dashboard → optional resolved-device-collection sources + runtime page (env-overridable credentials and `BASE_URL`).
- Extended `docs/DASHBOARD2_REVIEW.md` with how to run the script.

Intent: repeatable host-level checks when automated `TestClient` login does not match a long-lived DB (e.g. password changed from bootstrap defaults).

---

## 2026-04-29 — Phase 11: Dashboard2 review UX, widget states, map overlays, demo seed

Polished the flag-gated Dashboard2 review path and runtime shell without changing legacy `/dashboard/:id/edit|live` routes (comment in `services/frontend/src/App.tsx`).

**Frontend**
- `Dashboard2ReviewPage`: API-backed dashboard list, search, demo highlight, links to live/edit/preview and legacy editor.
- `DashboardRuntimeGrid` + `DashboardRuntimeDataProvider`: loading/error/empty (table) states; `lastFetchedAt` per resolved-collection binding; `refreshVersion` ties live auto-refresh to refetch.
- `DashboardLiveScreen2`, `Dashboard2PreviewPage`, `Dashboard2EditPage`: navigation between review, live, edit, preview, legacy.
- `LocationHeadingMapWidget`: map legend + summary overlay; `dashboard2.css` extended (review layout, overlays, `.dm-sr-only`).
- `normalizeDashboard2Definition`: accept schema v2 blob embedded in `layout`; `migrateLegacyDashboardToGrid`: preserve `resolved_device_collection` bindings from legacy JSON.
- `lib/dashboard2/demoConstants.ts`: shared demo dashboard title.

**Backend**
- `services/api/app/core/dashboard2_demo_seed.py`: idempotent startup seed for **Demo — Fleet / Map (Dashboard2)** (v1 layout passing validation); wired from `services/api/app/main.py` after bootstrap admin.
- `services/api/tests/test_dashboard2_demo_seed.py`: layout validation smoke.

**Docs / repo layout**
- `docs/DASHBOARD2_REVIEW.md`: manual verification checklist (screenshots not stored in-repo).
- `README.md`: Phase 11 summary.
- `services/platform-api/README.md`: pointer stub for cross-service docs.

Validation: `pytest tests/test_dashboard2_demo_seed.py tests/test_dashboard_endpoint_group_acceptance.py`; `npm --prefix services/frontend run lint` + `run build`.

---

## 2026-04-29 — Phase 10: resolved-device-collection runtime contract (map, summary, rollups/trends)

Hardened `GET /api/v1/dashboards/runtime/resolved-device-collection` and dashboard2 consumers around real payloads:

- **Backend** (`services/api/app/services/dashboard_resolved_device_collection.py`): refactored ranked LDS subquery; added `require_location` + SQL filter on non-empty `location_json.lat`/`lon`; `summary.excluded_missing_location` via `count_deduped_missing_location`; optional `include_excluded_missing_location_count` so multi-page internal loads skip repeat counts while HTTP pages keep a correct excluded count.
- **API** (`services/api/app/api/v1/dashboard.py`, `services/api/app/schemas/dashboard.py`): query param `require_location`; response always includes `rollups` and `trends` (empty objects for now); summary includes `excluded_missing_location`.
- **Live map** (`services/api/app/services/dashboard_live.py`): `location_heading_map` treated like `map`/`fleet_map`; `_load_resolved_collection_rows(..., require_location=True)` for resolved-collection map so markers stay LDS-only with server-side coordinate filtering.
- **Frontend** (`services/frontend/src/api/dashboard.ts`, `DashboardRuntimeDataProvider.tsx`, `LocationHeadingMapWidget.tsx`): `requireLocation` on fetch when the binding is used only by `location_heading_map`; map meta shows excluded count; runtime item types include `updated_at` / `scrubbed_event_id`.
- **Tests** (`services/api/tests/test_dashboard_endpoint_group_acceptance.py`): OpenAPI contract assertions; map/load `require_location=True` for `map` and `location_heading_map`.

Intent: Phase 10 runtime/data contract verification—map payload shape unchanged (items from `latest_device_state` read model), explicit missing-GPS cohort count, stable keys for KPI/health (`summary`) and placeholder `rollups`/`trends` for chart/trend widgets.

Validation: `pytest tests/test_dashboard_endpoint_group_acceptance.py`; `npm --prefix services/frontend run lint` and `run build`.

Follow-ups: populate `rollups` / `trends` from time-series storage when product defines those aggregates; optional nested `gps.lat`/`gps.lon` if LDS payloads standardize on nested paths.

---

## 2026-04-29 — v7 Phase 9: dashboard2 route integration and safe review gating

Integrated Dashboard 2.0 for safe runtime review behind feature flag, without touching legacy dashboard edit/live routes:
- Added feature-flag utility `services/frontend/src/lib/featureFlags.ts` using `VITE_DASHBOARD2_ENABLED`.
- Added dashboard2 pages/routes:
  - `Dashboard2EditPage` (`/dashboard2/:dashboardId/edit`)
  - `Dashboard2LivePage` (`/dashboard2/:dashboardId/live`)
  - `Dashboard2PreviewPage` (`/dashboard2/:dashboardId/preview`)
  - `Dashboard2ReviewPage` (`/dashboard2/review`) for controlled route entry.
- Updated `services/frontend/src/App.tsx` to register dashboard2 routes only when flag enabled.
- Added nav entry (`Dashboard2 Review`) only when flag enabled via `services/frontend/src/layouts/shell/navigation.ts`.
- Added compatibility loader path:
  - `services/frontend/src/lib/dashboard2/normalizeDashboard2Definition.ts`
  - `services/frontend/src/pages/dashboard2/useDashboard2Load.ts`
  to load existing dashboard records via schema-v2 shape or legacy migration fallback.
- Added dashboard2 page/shell styling extensions in `services/frontend/src/components/dashboard2/dashboard2.css`.

Intent: allow live evaluation of dashboard2 edit/live/preview flows while preserving current production dashboard wiring and routes.

Validation:
- `npm --prefix services/frontend run lint` passed.
- `npm --prefix services/frontend run build` passed.

Acceptance checks covered:
- legacy `/dashboard/:dashboardId/edit` and `/dashboard/:dashboardId/live` routes remain intact in router,
- new dashboard2 routes render through migration compatibility layer,
- widget surfaces (including map widget path) are reachable in dashboard2 runtime,
- no legacy route replacement or data wiring mutation introduced.

---

## 2026-04-29 — v7 Phase 8: CSS boundary cleanup guardrails

Completed Dashboard 2.0 CSS isolation guardrail phase:
- Added `docs/DASHBOARD2_CSS_BOUNDARIES.md` with live/preview/designer separation rules and forbidden selector-coupling examples.
- Updated `services/frontend/scripts/check-design-drift.mjs` to scan CSS and fail when live+preview dashboard selectors are coupled in one comma-separated rule (`.page-card.dash-live-page ... , .dash-preview-panel__scroll--fit ...`).
- Kept existing legacy runtime classes intact while adding automated policy enforcement for future edits.

Intent: prevent recurrence of preview/live CSS coupling regressions and formalize migration-safe style boundaries for v2 rollout.

Validation:
- `npm --prefix services/frontend run lint` passed.
- `npm --prefix services/frontend run lint:design` passed.

Follow-up: integrate `dashboard2` shells behind route/feature flag and progressively migrate existing dashboard edit/live pages to v2 components.

---

## 2026-04-29 — v7 Phase 7: live runtime shell hardening scaffold

Added Dashboard 2.0 live runtime shell scaffolding:
- Added `services/frontend/src/components/dashboard2/DashboardLiveScreen.tsx` with:
  - read-only runtime shell metadata,
  - bounded auto-refresh cadence display,
  - runtime grid rendering in `mode="live"`.
- Added `services/frontend/src/components/dashboard2/useDashboard2AutoRefresh.ts` hook to provide safe interval refresh behavior (`5..3600` sec bounds).
- Added live shell style tokens/classes in `services/frontend/src/components/dashboard2/dashboard2.css`.

Intent: harden v2 live-screen behavior and refresh orchestration in a dedicated namespace without modifying existing live runtime routes.

Validation: `npm --prefix services/frontend run lint` passed.

Follow-up (Phase 8): CSS cleanup boundary documentation and retirement/isolation rules for legacy shared selectors.

---

## 2026-04-29 — v7 Phase 6: designer configuration shell scaffolding

Added Dashboard 2.0 designer configuration UI scaffolding in `dashboard2` namespace:
- Added `DashboardDesignerShell` to compose canvas + preview + config panel.
- Added `DashboardWidgetConfigPanel` for widget metadata/settings editing.
- Added `DashboardWidgetBindingPicker` for source binding fields and sourceType switching.
- Added corresponding layout/form styles in `services/frontend/src/components/dashboard2/dashboard2.css`.

Intent: provide a dedicated v2 designer configuration flow without modifying the current Dashboard Edit page wiring.

Validation: `npm --prefix services/frontend run lint` passed.

Follow-up (Phase 7): live-screen hardening layer (read-only shell contracts, refresh behavior hooks, and runtime safety guards).

---

## 2026-04-29 — v7 Phase 5: core dashboard2 widgets implemented

Implemented core non-map widgets for Dashboard 2.0 registry:
- Added widget components:
  - `KpiTileWidget`
  - `TimeSeriesChartWidget` (recharts line series)
  - `DataTableWidget`
  - `HealthSummaryWidget`
  - `AlertFeedWidget`
  - `TrendPanelWidget`
  - `TextWidget2`
- Updated `services/frontend/src/components/dashboard2/DashboardWidgetRegistry.tsx` to map registry entries to concrete components (replacing placeholder mappings).
- Expanded `services/frontend/src/components/dashboard2/dashboard2.css` with widget-specific presentation styles.

Intent: ensure Dashboard 2.0 runtime has a complete baseline widget surface for operational KPI/chart/table/summary use cases.

Validation: `npm --prefix services/frontend run lint` passed.

Follow-up (Phase 6): implement designer configuration shell (binding picker + widget config editing + preview validation surface).

---

## 2026-04-29 — v7 Phase 4: LocationHeadingMapWidget scaffold (dashboard2)

Implemented Dashboard 2.0 map widget scaffold in the new `dashboard2` path:
- Added `services/frontend/src/components/dashboard2/widgets/LocationHeadingMapWidget.tsx`.
- Registry wiring updated so `location_heading_map` now renders with the new map component.
- Implemented core behaviors against resolved-device-collection runtime payload:
  - marker rendering from `location_json.lat/lon`,
  - heading rotation using `location_json.heading`,
  - health/lifecycle color mapping,
  - popup metadata baseline,
  - first-load auto-fit bounds logic.
- Added map widget styles/marker styles to `services/frontend/src/components/dashboard2/dashboard2.css`.

Intent: establish the Location/Heading map contract for Dashboard 2.0 without disrupting current dashboard pages.

Validation: `npm --prefix services/frontend run lint` passed.

Follow-up (Phase 5): add core non-map widget implementations in `dashboard2` runtime renderer.

---

## 2026-04-29 — v7 Phase 3: runtime data provider scaffold (binding-key grouped)

Added Dashboard 2.0 runtime data-provider scaffolding in frontend:
- Added `fetchResolvedDeviceCollection(...)` to `services/frontend/src/api/dashboard.ts` with endpoint-group query support (`site_id`, `endpoint_id`, `object_name`, optional filters/cursor/limit).
- Added `services/frontend/src/components/dashboard2/DashboardRuntimeDataProvider.tsx`:
  - `getBindingKey(binding)` for deterministic request-keying,
  - grouped fetches per unique binding key,
  - loading/error/data state map exposed via context.
- Updated `services/frontend/src/components/dashboard2/DashboardRuntimeGrid.tsx` to resolve widget runtime data through provider/hook instead of per-widget ad hoc calls.

Intent: enforce a single runtime data access pattern for Dashboard 2.0 widgets while preserving current production dashboard API/data wiring.

Validation: `npm --prefix services/frontend run lint` passed.

Follow-up (Phase 4): implement `LocationHeadingMapWidget` contract scaffold and map runtime integration path for endpoint-group bindings.

---

## 2026-04-29 — v7 Phase 2: legacy-to-grid compatibility helpers

Added migration/compatibility utilities for schema-versioned Dashboard 2.0 rollout:
- Frontend: added `services/frontend/src/lib/dashboard2/migrateLegacyDashboardToGrid.ts` to convert legacy `layout.rows[].columns[]` into v2 `layouts/widgets` shape.
- Backend: added additive helper `services/api/app/services/dashboard_schema_migration.py` to produce a baseline schema_version=2 payload from legacy layout JSON.
- Tests: added `services/api/tests/test_dashboard_schema_migration.py` (basic migration shape coverage).
- Type compatibility: extended `services/frontend/src/types/dashboard.ts` `DashboardReadDTO` with optional `schema_version`, `layouts_json`, `widgets_json`.

Intent: keep existing dashboards readable while enabling a controlled migration path to Dashboard 2.0 grid schema.

Validation:
- `npm --prefix services/frontend run lint` passed.
- `pytest -q services/api/tests/test_dashboard_schema_migration.py` passed.

Follow-up (Phase 3): add runtime data provider + request grouping/caching for binding-key based widget fetches.

---

## 2026-04-29 — v7 Phase 1: Dashboard 2.0 foundation scaffold

Added additive Dashboard 2.0 frontend scaffolding (no runtime wiring replacement yet):
- Installed `react-grid-layout` + `react-resizable` in frontend dependencies.
- Added v2 dashboard definition/layout/widget/binding types in `services/frontend/src/types/dashboard2.ts`.
- Added v2 widget registry and runtime renderer scaffold:
  - `services/frontend/src/components/dashboard2/DashboardWidgetRegistry.tsx`
  - `services/frontend/src/components/dashboard2/DashboardWidgetRuntimeRenderer.tsx`
- Added v2 widget frame/chrome in `services/frontend/src/components/dashboard2/DashboardWidgetCard.tsx`.
- Added v2 grid shells:
  - `DashboardDesignerGrid` (draggable/resizable)
  - `DashboardRuntimeGrid` (preview/live read-only)
- Added isolated v2 stylesheet namespace in `services/frontend/src/components/dashboard2/dashboard2.css`.

Intent: establish a clean Dashboard 2.0 architecture surface without disturbing existing Dashboard Edit page behavior or current data wiring.

Validation: `npm --prefix services/frontend run lint` passed.

Follow-up (Phase 2): introduce legacy-to-grid compatibility/migration helpers and schema-version aware shape handling.

---

## 2026-04-29 — v7 kickoff: Dashboard List actions icon polish (UI-only)

Added an icon to the Dashboard List Actions column header without changing dashboard edit/runtime behavior:
- Updated `services/frontend/src/pages/dashboard/DashboardListPage.tsx` to show a `MoreHorizontal` icon next to `Actions`.
- Added shared header-icon alignment helper `.dm-data-table__th-label-with-icon` in `services/frontend/src/pages/device-register-page.css`.

Intent: improve dashboard list visual clarity while keeping all existing data wiring, action handlers, and dashboard edit page logic unchanged.

Validation: `npm --prefix services/frontend run lint` passed.

Follow-up: proceed with Dashboard 2.0 phased architecture refactor (designer/preview/live separation) in isolated milestones to avoid regressions.

---

## 2026-04-29 — Temporarily disabled preview-isolation CSS block

Per request, commented out the new builder preview-isolation CSS section in `services/frontend/src/index.css` to defer this fix:
- Disabled `.dash-live--preview` layout rules (row/grid/stack/widget/map/chart overrides).
- Disabled preview-only widget/container override block tied to `dash-preview-panel__scroll--fit`.
- Left explicit TODO markers so this section can be re-enabled/refined later.

Intent: pause unstable preview behavior changes and revisit with a focused fix later.

Validation: `npm --prefix services/frontend run lint` passed.

Follow-up: when resuming, isolate one preview path at a time (right rail vs configure modal) and validate computed styles in-browser before adding global overrides.

---

## 2026-04-29 — Hard separation: live fit-page vs builder preview runtime

Implemented runtime-mode and CSS separation so right-rail preview no longer uses live full-page fit behavior:
- `services/frontend/src/components/dashboard/DashboardPreviewPanel.tsx`: preview now renders `DashboardLiveRenderer` with `fitPage={false}` and `layoutDensity="preview"`.
- `services/frontend/src/components/dashboard/DashboardLiveRenderer.tsx`: added `"preview"` layout density, `dash-live--preview` class, and excluded preview from fit-page logic in both runtime shell and responsive-grid fit wiring.
- `services/frontend/src/index.css`: removed shared comma-coupled live+preview selector usage in the live dashboard tile/tuning block and kept those rules live-only.
- Added preview-only structural rules (`.dash-live--preview`, `.dash-live--preview .dash-row`, `.dash-live--preview .dash-widget-stack`, `.dash-live--preview .dash-wf`, map/chart min-heights) and adjusted preview widget container behavior (`container-type: inline-size`, natural height flow).
- Builder rail dimensions retained for isolation (`.dash-builder` right rail min 360, `.dash-preview-panel` min-width 360, min-height 0).

Intent: preserve live dashboard full-page weighted/flex behavior while making builder preview natural-height, scrollable, and independent of live compression rules.

Validation: `npm --prefix services/frontend run lint` passed.

Follow-up: if a specific widget still clips in preview, tune only that widget’s `.dash-live--preview` subtree styles instead of re-introducing shared live+preview selectors.

---

## 2026-04-29 — Dashboard builder preview/live CSS separation and right-rail sizing fix

Applied preview-specific layout rules in `services/frontend/src/index.css` so builder preview does not inherit live-dashboard compression behavior:
- Updated `.dash-builder` columns to `11rem minmax(0, 1fr) minmax(360px, 30vw)` and set `.dash-preview-panel` minimum width to `360px`.
- Kept preview scroll containers independently scrollable and changed preview `.dash-live`/`.dash-row`/`.dash-widget-stack` to natural-height flow in right rail.
- Added explicit preview widget sizing for map/chart (`min-height`), removed map flex dominance in preview (`flex: none !important`), and added preview-only overrides to prevent live container-size/flex rules from forcing full-height compression.

Intent: separate live-page sizing from builder-preview sizing so widget sections stop mixing/stacking incorrectly in the narrow preview rail.

Validation: `npm --prefix services/frontend run lint` passed.

Follow-up: if any single widget still over-compresses, tune that widget's preview-specific body wrapper rather than re-coupling to live page selectors.

---

## 2026-04-29 — Dashboard preview clipping fix (all widgets, structural)

Reworked Configure Widget preview rendering to avoid frame-header clipping across all widget types:
- Updated `services/frontend/src/components/dashboard/DashboardWidgetConfigDrawer.tsx` to render a dedicated preview title row above the widget preview and to force `presentation.showTitle = false` for the preview-only block.
- Added `.dash-widget-config-preview-title` styling in `services/frontend/src/index.css` for consistent spacing/typography in both chart and non-chart configure flows.

Intent: remove dependence on fragile per-widget/per-class overflow overrides by making preview titles deterministic and outside widget frame clipping contexts.

Validation: `npm --prefix services/frontend run lint` passed.

Follow-up: if clipping is still observed in preview content (not header text), the next step is auditing content-body height/overflow in `DashboardWidgetView` render wrappers.

---

## 2026-04-29 — Dashboard widget-config preview title truncation fix

Adjusted Configure Widget preview-pane typography in `services/frontend/src/index.css` to prevent title/meta truncation:
- `.dash-widget-config-preview-pane .dash-wf__title` / `.dash-widget__title` now allow wrapping (`white-space: normal`, `word-break: break-word`) and disable clipping/ellipsis.
- `.dash-widget-config-preview-pane .dash-wf__meta-item` now wraps long source/meta strings (`overflow-wrap: anywhere`).

Intent: keep preview readable for long widget titles like Device summary/alert titles without changing widget sizing, live dashboard page behavior, or global nav/layout styles.

---

## 2026-04-29 — Dashboard kpi-strip preview clipping fix

Follow-up fix for Configure Widget preview when widget frame class includes `dash-wf--kpi-strip` (Device summary strip):
- `.dash-widget-config-preview-pane .dash-wf--kpi-strip .dm-kpi` now allows visible overflow and slightly larger minimum height.
- `.dm-kpi__label` in preview now wraps (`flex-wrap: wrap`) to avoid cutting long label text.
- `.dm-kpi__sub` in preview now wraps (`white-space: normal; overflow-wrap: anywhere`).
- `.dash-wf__body` for kpi-strip preview now scrolls when needed instead of clipping.
- `dash-ops-kpi-inner.dm-kpi-row--equal-5` in preview now reflows to 2 columns (3 on wider preview), avoiding forced 5-column squeeze that truncated text.
- Additional hardening: preview-specific overflow/height overrides for `.dash-widget-stack` and `.dash-wf--kpi-strip` (`overflow: visible`, `height: auto`, `min-height: 0`) so the frame itself does not crop KPI-strip content.
- Root-frame fix in `components/dashboard/dashboardWidgetFrame.css`: `dash-wf--kpi-strip` header/title now reserve explicit vertical room and visible overflow (`.dash-wf__header-main` / `.dash-wf__title` / `.dash-wf--kpi-strip .dash-wf__header` / `.dash-wf--kpi-strip .dash-wf__title`) so the title is enclosed by the widget frame instead of clipping at the top edge.
- Additional escalation after repeated repro: force `dash-wf--kpi-strip` root overflow visible in component frame CSS, and add preview-only `!important` overrides in `index.css` for `overflow/height/header` so later stylesheet order cannot reintroduce clipping.

Scope is preview-pane only; no live dashboard page/global nav/widget-size changes.

---

## 2026-04-29 — Step 5 acceptance tests expanded (auto-reflect, pagination, map latest-only, no data_object)

Extended `services/api/tests/test_dashboard_endpoint_group_acceptance.py` with runtime-focused acceptance coverage:

- **New/removed devices auto-reflect:** repeated `resolve_widget_data()` calls for endpoint-group table return changed resolved-device rows when cohort loader output changes.
- **Pagination behavior:** `_load_resolved_collection_rows()` test spans multiple mocked pages and verifies merged rows + aggregate summary totals/avg-health across pages.
- **Map latest-only source path:** endpoint-group map output emits `included_sources` using only `sourceType=latest_device_state` entries.
- **No data_object path:** existing runtime guard test retained (`_load_source_record` returns no data for `data_object`).

Validation run: `pytest -q services/api/tests/test_dashboard_endpoint_group_acceptance.py` → **10 passed**.

---

## 2026-04-29 — Endpoint Group Step 5 acceptance tests

Added acceptance-focused API tests for endpoint-group dashboard binding in `services/api/tests/test_dashboard_endpoint_group_acceptance.py`:
- Source policy checks:
  - `resolved_device_collection` allowed,
  - `data_object` excluded.
- Layout validation checks:
  - endpoint-group binding accepted when `siteId + endpointId + objectName` present,
  - rejected when required fields are missing.
- Pagination cursor determinism contract checks:
  - encode/decode round-trip for cursor payload (`updated_at`, `scrubbed_event_id`, `resolved_device_id`).
- Shared status vocabulary checks:
  - lifecycle buckets (`online`, `late`, `offline`, `error`),
  - health buckets (`healthy`, `warning`, `critical`, `unknown`).
- Runtime guard check:
  - dashboard live source loader does not resolve `data_object` fallback.
- OpenAPI route checks:
  - `/api/v1/dashboards/sources/resolved-device-collections`,
  - `/api/v1/dashboards/runtime/resolved-device-collection`.

Validation run: `pytest -q services/api/tests/test_dashboard_endpoint_group_acceptance.py` → **7 passed**.

---

## 2026-04-29 — Endpoint Group dashboard source: Step 3 + 4 runtime + guards

Completed Step 3 (widget runtime adapters) and Step 4 (validation/runtime guardrails) after Step 1+2 commit.

**Runtime adapters (`services/api/app/services/dashboard_live.py`):**
- Added `resolved_device_collection` runtime loading path that resolves endpoint-group rows and aggregate summary.
- Wired widget data generation for endpoint-group bindings:
  - `map`: emits `manual_sources` list of `latest_device_state` IDs for marker query path,
  - `table`: one row per resolved device with health/lifecycle fields,
  - `kpi`: summary metric support (`total`, lifecycle/health counts, `avg_health_score`, metric fallback),
  - `chart`: current-state bucket chart series from collection summary,
  - `device_tile`: cohort summary tile payload,
  - `alert_summary`: warning/critical summary + recent per-device entries.

**Guardrails:**
- `dashboard_live._load_source_record` now rejects `data_object` resolution (returns no source for v2 dashboards).
- Existing layout/source validation continues to block `data_object` bindings and now includes endpoint/site coherence checks for `resolved_device_collection`.

**Documentation:**
- Updated root `README.md` with endpoint-group default binding model, new APIs, deterministic ordering/cursor semantics, and explicit “Individual Device is advanced / no data_object fallback” note.

Follow-up pending (Step 5): acceptance tests.

---

## 2026-04-28 — Endpoint Group dashboard source (Step 1 + 2)

Implemented initial Endpoint Group support with the product rule: **Endpoint Group is default; Individual Device is advanced**.

**Step 1 (DB/service/API):**
- Added dashboard runtime endpoint: `GET /api/v1/dashboards/runtime/resolved-device-collection`.
- Added builder source endpoint: `GET /api/v1/dashboards/sources/resolved-device-collections`.
- Added deterministic ordering and cursor semantics in service layer:
  - `ORDER BY updated_at DESC, scrubbed_event_id DESC, resolved_device_id ASC`
  - cursor encodes `updated_at`, `scrubbed_event_id`, `resolved_device_id`.
- Added server-side dedupe fallback by `resolved_device_id` via window ranking (`row_number()`) with the same deterministic ordering.
- Added shared lifecycle/health summary bucket mapping and API summary payload (`online/late/offline/error`, `healthy/warning/critical/unknown`).

**Step 2 (builder binding model):**
- Extended dashboard widget binding model with endpoint-group fields (`sourceMode`, `siteId`, `endpointId`, `objectName`, optional filters).
- Switched default bindings for `kpi/table/chart/device_tile` to `sourceType: resolved_device_collection` and `sourceMode: endpoint_group`.
- Updated dashboard widget config UI to select:
  - Source mode: Endpoint Group (default) vs Individual Device (advanced),
  - Endpoint Group picker from resolved-device-collection source list.

**Safety/validation touched for compatibility:**
- Dashboard layout validation now accepts `resolved_device_collection` and checks endpoint/site coherence for this binding type.

Follow-ups intentionally deferred: runtime widget adapters, stricter guardrails, and acceptance tests (Steps 3–5).

---

## 2026-04-28 — Dashboard edit preview clipping fix (sticky panel + inner scroll)

Adjusted dashboard builder preview panel CSS in `services/frontend/src/index.css` to prevent visual clipping/truncation in edit mode:
- `.dash-preview-panel` now keeps sticky behavior with explicit shell-aware height (`top: var(--dash-preview-sticky-top, 12px)`, `max-height: calc(100dvh - ... - 96px)`, `min-height: 320px`, flex column, `overflow: hidden`).
- `.dash-preview-panel__scroll--fit` changed from `overflow: hidden` to `overflow: auto` with `min-height: 0`.
- Added shrink-safe live preview rules for both fit and regular preview scroll containers:
  - `.dash-preview-panel__scroll--fit > .dash-live`
  - `.dash-preview-panel__scroll > .dash-live`
  both use `flex: 1 1 auto`, `min-height: 0`, `min-width: 0`.

Intent: keep right preview sticky and usable while allowing preview content to scroll instead of being cut off; no global page overflow hacks, nav changes, or widget-size changes.

---

## 2026-04-28 — Dashboard widget config: 3-column editor with larger preview

Updated `DashboardWidgetConfigDrawer` to a three-column non-chart layout:
- **Column 1:** `Title`, `Source type`, `Source` selector, plus expandable **Advanced widget options** (`DashboardBindingEditor`).
- **Column 2:** enlarged **Preview** pane with larger minimum height and scroll container to prevent clipped/truncated content.
- **Column 3:** always-visible **Debug JSON** pane with independent scrolling.

Supporting CSS in `index.css`:
- widened `.dash-config-modal` for desktop (`min(1380px, 98vw)`),
- added responsive 3-column grid + pane sizing,
- added fallback single-column stacking under narrower widths.

Intent: improve dashboard edit usability by making preview readable without collapsing controls or hiding debug output.

---

## 2026-04-28 — Design cleanup tranche 1 (CSS tokens + components)

**Buttons:** Moved canonical `.aar-btn` / variants and `.dm-btn` **aliases** into `aar-primitives.css`; removed duplicate button block from `device-register-page.css`. `AarButton` now emits `aar-btn` + `dm-btn` classes. Dashboard builder / header CSS in `index.css` extended for `.aar-btn` where it already targeted `.dm-btn`.

**Pager:** `PlainOperationalTable` pager uses `AarButton` + `.op-table-pager__action`; removed `op-table-pager__btn`. **Lint:** ESLint + `check-design-drift.mjs` forbid `op-table-pager__btn`.

**Call sites (sample migration):** `FieldExplorerPanel`, `ScrubberPipelinesPage`, `WorkflowListPage`, `DashboardListPage` (AarButton / link classes).

**Docs:** [`FRONTEND_DESIGN_COMPONENTS.md`](./FRONTEND_DESIGN_COMPONENTS.md); ticket [`DESIGN_CLEANUP_CSS_TOKENS_TICKET.md`](./DESIGN_CLEANUP_CSS_TOKENS_TICKET.md) updated to in-progress.

---

## 2026-04-28 — Scrubber 2.0: remove hero scope strip

Removed `dm-page-hero__scope` block (inline `OpsScopeControls` / time range) from `Scrubber2Page.tsx`; dropped unused `.dm-page-hero__scope` rules from `device-register-page.css`.

---

## 2026-04-28 — Split `ba8d19c` into five commits (crash-safer history)

Replaced single squash with sequential commits on `v2-endpoints-rebuild`:

1. `cc8fce9` — **Capture endpoint samples before identity mapping** (migration `0031` columns, model, worker ingest + CoAP bound path, REST raw sample + Kafka gate, `endpoint_sample_service`).
2. `cf9805c` — **Add endpoint identity publish lifecycle** (schemas, `endpoints` publish + draft PATCH, `endpoint_identity_publish`, `primary_device_key` API copy, `v2_resolution` publish guard, OpenAPI route tests).
3. `fa0321e` — **Add endpoint identity mapping UI** (React route, ingest table link, API client).
4. `cd8dddb` — **Enforce v2 dashboard workflow and AI sources** (dashboard validation, map eligible list, AI datasets, workflow graph validation + create/update checks).
5. **Add v2 endpoint identity lifecycle tests** — `test_v2_endpoint_identity_lifecycle.py` + this log (same commit as message `Add v2 endpoint identity lifecycle tests` on `v2-endpoints-rebuild`).

**Push:** This clone has no `git remote`; configure `origin` then `git push origin v2-endpoints-rebuild` after each slice locally if desired.

---

## 2026-04-28 — Step 1: foundation commit (`710a0d2`)

**Commit:** `Rebuild v2 endpoint foundation and MQTT binding` — `710a0d2` on `v2-endpoints-rebuild`.

**Staged paths:** `services/api`, `services/workers`, `services/frontend` (per recovery plan).

**Pre-commit checks:**

- `npm run build` in `services/frontend` — pass.
- `docker compose exec api alembic upgrade head` — DB at `0030_endpoint_lifecycle_sample (head)`.
- `docker compose exec api python -c "from app.main import app"` — pass.
- `python3 -m py_compile` on touched API/worker modules — pass.
- `pytest tests/test_v2_endpoint_schemas.py` (host `.venv` in `services/api`) — 5 passed.

**Includes (high level):** migrations `0029`/`0030`, endpoint lifecycle + nullable PK + MQTT v2 ingest archive path, ingest quarantine for unbound/device-only, `v2_resolution` guard without PK fields, tenant operational clear async (Redis job) + related API/UI, assorted frontend layout/dashboard/vite chunking.

**Next (recovery plan):** Step 2 — sample capture across protocols; Step 3 — activate endpoint only from Scrubber 2.0 publish; Step 4 — Scrubber identity UI; Step 5 — v2 read-model boundaries; Step 6 — acceptance tests.

---

## 2026-04-28 — Baseline + tracking setup

**Context:** Session crash recovery; user asked to track changes going forward.

**Repo / branch:** `v2-endpoints-rebuild` (per earlier `git status`); large **uncommitted** set remained (API, workers, frontend, migrations `0029`/`0030`, `tenant_operational_clear_job.py`).

**Product audit (approved ingest/identity plan vs code):**

- Present: endpoint schema/model for `lifecycle_status`, `sample_payload`, `sample_ingested_at` (migration `0030`); nullable `primary_device_key_fields`; strict ingest quarantine for unbound/device-only; MQTT v2 archive path; `v2_resolution` writes v2 rows only when PK fields extract successfully; scope checks vs endpoint row.
- Missing / partial: no workers writing `sample_payload`; lifecycle `needs_sample` / `error` unused; `active` not tied to Scrubber 2.0 publish; CoAP still calls rejected unbound ingest; Scrubber UI not wired to endpoint sample; acceptance tests not covering full flow.

**This commit:** Added `docs/ITERATION_LOG.md` with discipline to prepend a dated section after substantive edits.

---
