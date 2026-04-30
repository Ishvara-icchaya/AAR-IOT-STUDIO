# Dashboard widget contract & runtime (consolidated spec)

This document is the **implementation contract** for repairing dashboard data loading, widget payloads, and layout/rendering. It merges runtime API design, backend builders, frontend behavior, legacy rules, layout containment, and acceptance criteria.

---

## 1. Goals

1. **Data path:** Widget data on the dashboard canvas comes only from **backend-prepared, contract-shaped payloads** via **`POST .../resolve-batch`**. No frontend inference from raw or collection payloads on the canvas.
2. **Layout:** The **layout engine owns cell size**; a **standard widget frame** owns containment; **renderers only own content** inside the body (scale or scroll, never escape the frame).
3. **No parallel truths:** One canonical metadata route and one canonical widget data route; **preview and live** use the **same** resolver, RBAC, and widget frame.

---

## 2. Runtime architecture

| Concern | Canonical API |
|--------|----------------|
| Layout + widget definitions + config (**no widget data**) | `GET /api/v1/dashboards/{id}/runtime-layout` |
| Widget-ready data | `POST /api/v1/dashboards/runtime/widgets/resolve-batch` |

- **Live and preview** both use **`resolve-batch`** for widget data.
- **Transition:** A legacy “live” route may remain as a **compatibility wrapper** that delegates **metadata** to the same `runtime-layout` service. It **must not** embed a second widget data resolver that diverges from `resolve-batch`.

### 2.1 Draft preview

`resolve-batch` supports two modes:

| Mode | Request |
|------|--------|
| **Persisted** | `dashboardId` + widget identifiers (and types/sources as required). |
| **Unsaved draft** | Request body may include **`dashboardLayoutDraft`**. |

**Draft rules:**

- Enforce **current user** customer/site/endpoint scope.
- Validate `siteId` / `endpointId` / `objectName` as for persisted dashboards.
- Reject **`data_object`** bindings.
- **Do not persist** anything.

### 2.2 Preview vs live authorization

Preview and live use the **same** resolver and **same** RBAC/site restrictions. Preview **must never** bypass customer scope, site scope, endpoint/site validation, or the **`data_object` ban**.

---

## 3. `DashboardWidgetPayload` envelope (camelCase only)

Every widget in a batch uses one envelope. **All** runtime JSON field names for this contract use **camelCase** (no snake_case in frontend-facing payloads).

| Field | Description |
|-------|-------------|
| `widgetId` | Widget instance id. |
| `widgetType` | Canonical type string (see §6). |
| `status` | `ok` \| `empty` \| `degraded` \| `error` |
| `title`, `subtitle` | Optional chrome. |
| `message` | **Primary** user-facing string (errors, empty, legacy, unknown widget). |
| `generatedAt` | ISO timestamp **per widget**. |
| `source` | Single object: `sourceType`, optional `siteId`, `endpointId`, `objectName`. |
| `data` | Contract-specific payload. |
| `meta` | Optional: `warnings[]`, `emptyReason`, `latencyMs`, etc. — **secondary** to `message`. |

**Batch response** may include **`batchGeneratedAt`**.

### 3.1 HTTP semantics (batch)

- **200** if the batch request is **authorized and structurally valid**.
- Each widget carries its own **`status`**.
- **4xx/5xx** only when the **entire** request fails: invalid shape, unauthorized user, denied dashboard/site access, or other whole-request failure.

### 3.2 Partial batch failure (unknown widget id)

If one `widgetId` is invalid or not part of the dashboard, still return **200** for the batch (when otherwise authorized). That item returns:

- `widgetType`: **`invalid_widget_reference`** (not a generic `"unknown"` string — see §6).
- `status`: **`error`**
- `message`: e.g. *Widget is not part of this dashboard or is no longer available.*

Use **4xx** only for whole-request problems (see §3.1).

### 3.3 User-facing copy

- **`message`** is the **primary** renderer string.
- **`meta.warnings`** are **secondary** diagnostics (e.g. rollup fallback).

---

## 4. Status semantics

| Status | Meaning |
|--------|--------|
| **ok** | Valid data returned. |
| **empty** | Valid query, no rows / nothing to show. |
| **degraded** | Partial data, missing optional fields, or fallback path used but **some** usable data returned. |
| **error** | Invalid binding, permission failure, site mismatch, unsupported source, legacy `data_object`, resolver failure. |

### 4.1 Trend: degraded vs empty vs error (fallback)

| Situation | `status` | Notes |
|-----------|----------|--------|
| Rollup unavailable + bounded events fallback **returns rows** | `degraded` | e.g. `meta.warnings`: rollup unavailable; using bounded aggregation. |
| Rollup unavailable + fallback **zero rows** | `empty` | `message` e.g. no trend data for window; optional warning that fallback returned no rows. |
| Rollup unavailable + fallback **fails** | `error` | Appropriate `message`. |

---

## 5. `data_object` and leakage

**Do not expose:**

- `data_object` ids, `data_object` sourceType, internal table names, raw `data_object` payloads, or `data_object`-specific fallback warnings.

**Allowed:** business fields from whitelisted shapes (e.g. `identity_json`, `display_json`, `kpi_json`, `health_json`, `location_json`) — **only** fields defined in each widget’s contract (no dumping full blobs).

---

## 6. Canonical `widgetType` strings

- **Single source of truth:** All canonical `widgetType` values are defined in **one enum / constant module** (API); frontend uses the **same** constants or generated types.
- **No pluralization or spelling variants** in code (e.g. do not maintain both `ops_alert_trends` and `ops_alerts_trends`). Legacy stored `block.type` may differ; **only** the central **`block.type` → `widgetType` map** translates aliases.
- **Builders, OpenAPI, tests, and renderers** reference these constants — avoid scattered string literals.

### 6.1 Sentinel `widgetType` values

Do **not** use `widgetType: "unknown"` (collision risk).

| Case | `widgetType` | Typical `status` |
|------|----------------|------------------|
| `widgetId` not on dashboard / stale reference | **`invalid_widget_reference`** | `error` |
| Widget type not implemented or not allowed in v2 | **`unsupported`** | `error` |

Human-readable detail stays in **`message`**.

### 6.2 `block.type` → `widgetType` (no JSON migration in v1 of this work)

- Persisted layout may keep existing **`block.type`**.
- Runtime resolution uses a **central mapping table** (examples only — actual aliases live in code):

```json
{
  "ops_alert_trends": "ops_alert_trends",
  "ops_overview_kpis": "ops_overview_kpis",
  "table": "endpoint_collection_table",
  "chart": "endpoint_collection_trend",
  "kpi": "endpoint_collection_kpi",
  "summary": "endpoint_collection_summary",
  "location_heading_map": "location_heading_map",
  "map": "location_heading_map"
}
```

- **Do not migrate** stored dashboard JSON in this pass.
- Legacy unsupported bindings: **`status`: `error`**, **`message`**: e.g. *Legacy widget binding is not supported in v2 runtime. Rebind this widget.*
- Legacy **`data_object`** binding: **`status`: `error`**, **`message`**: e.g. *Legacy data_object binding is not supported in v2 runtime. Rebind this widget.*

---

## 7. Backend widget builders

**Layout (conceptual):** e.g. `services/api/app/dashboard/widget_builders/` with `base`, registry, and one module per widget type.

Each builder **must**:

1. Validate widget config.
2. Enforce customer/site scope.
3. Query the **v2 read model**.
4. Return **widget-ready** `data` (never raw `data_object`).
5. Never leak `data_object` internals (§5).

### 7.1 Ops reuse

**Do not duplicate** ops logic. Move or wrap existing ops builders so types like **`ops_alert_trends`** are **registered builders**, not a separate special code path.

### 7.2 Shared trend service

- **One** standard module (e.g. `dashboard_trend_service.py`).
- **Preferred:** rollup / Timescale rollups derived from `scrubbed_events`.
- **Fallback:** bounded `scrubbed_events` aggregation with hard limits.
- Individual widgets **must not** invent their own trend queries.

### 7.3 KPI delta

- **Server-side only.** Default: **current window vs previous equivalent window** (e.g. last 15m vs prior 15m).
- If no comparison window is configured → **`delta`: null**.
- Renderer **must not** compute delta.

### 7.4 Table pagination — opaque cursor (non-negotiable)

- **Cursor is a fully opaque token** generated only by the backend.
- The frontend **must not** parse, decode, modify, or construct cursors.
- Only the backend generates and interprets cursors on the next request.
- Backend owns **sort order** (e.g. default: `updated_at DESC`, `scrubbed_event_id DESC`, `resolved_device_id ASC` — finalize in implementation).
- Pagination encoding may evolve without client changes as long as clients **pass the token through unchanged**.

---

## 8. Widget `data` contracts (illustrative)

Exact fields are finalized per type in OpenAPI / types; shapes align with v2 read models.

**Endpoint collection KPI** — e.g. `value`, `label`, `unit`, `status`, optional `delta` (null when N/A).

**Endpoint collection table** — `columns`, `rows`, `pagination`: `{ nextCursor, pageSize }`.

**Endpoint collection trend** — `series[]` with `label` and `points[]` `{ ts, value }`.

**Endpoint collection summary** — e.g. `buckets[]` with `label`, `value`, `status`.

**Map / `location_heading_map`** — backend-prepared e.g. `features`, `summary`, `rollups`, `trends`; frontend renders with MapLibre; **same envelope** as other widgets.

---

## 9. Frontend

### 9.1 Canvas / runtime

- **Must** load widget data via **`resolve-batch`** only — no direct fetch of raw or collection data for dashboard cells.
- **Thin renderers:** branch on **`widgetType`**; pass **`data`** into typed components — **no** inference of shape from loose payloads.

### 9.2 Allowed outside runtime (builder)

Source pickers, endpoint selectors, field metadata, sample previews, validation endpoints — **metadata** APIs only.

### 9.3 Legacy behavior (do not break the whole app)

- **v2-compatible** widgets resolve normally.
- Legacy / `data_object` / unsupported → per-widget **`error`** (or **`degraded`** only when explicitly defined) with **`message`** from §6.2.
- **No automatic migration** of old bindings.

---

## 10. Layout & rendering (UI contract)

**Problem addressed:** Row/column layout allocates cells, but widgets may clip, overflow, or size independently of the cell.

**Ownership:**

1. **Dashboard row/column** defines cell width and height.
2. Each widget is wrapped in a **standard widget frame**.
3. **Frame** fills the assigned cell.
4. **Body** receives the exact remaining space (after header).
5. Content **scales to fit** and/or **scrolls inside** the body — **never** escapes the rounded frame.

### 10.1 Canonical structure

```html
<div class="dashboard-widget-cell">
  <div class="dashboard-widget-frame">
    <div class="dashboard-widget-header">...</div>
    <div class="dashboard-widget-body">
      <!-- optional inner scroll region for table/summary -->
      {widget renderer}
    </div>
  </div>
</div>
```

### 10.2 CSS principles

```css
.dashboard-widget-cell {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.dashboard-widget-frame {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--aar-border);
  background: var(--aar-surface);
  overflow: hidden;
}

.dashboard-widget-header {
  flex: 0 0 auto;
}

.dashboard-widget-body {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
```

For scrollable widgets, use an **inner** element with `overflow: auto` and `min-height: 0` so focus and scrolling stay correct.

### 10.3 Widget-type display rules

| Type | Behavior |
|------|----------|
| KPI | Scale typography to available space. |
| Table | Internal scroll + pagination inside body. |
| Chart | ResizeObserver / container-based resize (ECharts tracks **parent**, not window). |
| Trend | Fit SVG/canvas to body. |
| Summary | Wrap and/or scroll inside body. |
| Map / LocationHeadingMap | Fill body; overlays inside map bounds. |

### 10.4 Hard rules

- No **viewport-based** heights (e.g. `70vh`) inside a cell.
- No **page/body overflow** hacks.
- No relying on **content intrinsic height** to define **row** height.
- No escaping the **rounded widget frame**.
- Maps and charts resize from the **parent container**, not the window.

### 10.5 Builder preview

Preview **must** use the **same** widget frame and CSS rules as live — **no** separate preview sizing system.

### 10.6 Header and a11y

- Decide whether the header **wraps** or stays **single-line + ellipsis** so row height stays predictable.
- Ensure keyboard **focus** is not clipped incorrectly (scroll/focus region usually inside the scrollable inner).

---

## 11. Acceptance criteria

**Data / API**

- `resolve-batch` returns a **stable envelope**; **200** with per-widget errors for invalid widget refs.
- **401/403/400** only for whole-request failures.
- Endpoint collection KPI/table/trend/summary/map behave per contracts (v2 read paths, pagination, trend service).
- **`data_object`** rejected; **site mismatch** rejected.
- Batch returns **multiple** widgets.
- Canvas does not fetch collection/raw for widget data (builder metadata allowed).

**Layout**

- Widget fits inside assigned row/column.
- Rounded border always visible.
- No clipping **outside** the widget frame.
- Table scrolls internally.
- Chart resizes to cell.
- Map fills cell without breaking layout.
- **Preview and live** match (frame + sizing).

---

## 12. Principles (non-negotiable)

1. **Cell owns size → frame owns containment → renderer owns content.**
2. **Server prepares widget-ready payloads; client renders only.**
3. **One metadata route, one widget data route — no competing truths.**
4. **camelCase runtime JSON; one `source` object; `message` primary, `meta.warnings` secondary.**
5. **Preview = live = same RBAC, same frame, same `resolve-batch`.**
6. **Explicit contract-based widgets** — avoid generic “smart” widgets that infer shape on the frontend.
7. **Canonical `widgetType` enum** — no duplicate spellings; sentinel types **`invalid_widget_reference`** and **`unsupported`** only.
8. **Opaque cursors** — frontend never parses or constructs pagination tokens.

---

## 13. Reference architecture (mental model)

```text
Dashboard layout (runtime-layout)
       ↓
resolve-batch
       ↓
Widget builders (registry)
       ↓
v2 read models (latest_device_state, rollups, …)
       ↓
Thin frontend renderers + standard widget frame
```

This supports fleet, warehouse, and other endpoint-group dashboards without leaking internal storage shapes to the client.
