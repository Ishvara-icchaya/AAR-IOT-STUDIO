# Iteration log (append-only)

Purpose: durable trail of **what changed and why**, so work survives editor crashes and context loss.  
Convention: add a **new section at the top** (newest first) per session or logical batch of work.

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
- Cursor determinism contract checks:
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

**Context:** Cursor crash recovery; user asked to track changes going forward.

**Repo / branch:** `v2-endpoints-rebuild` (per earlier `git status`); large **uncommitted** set remained (API, workers, frontend, migrations `0029`/`0030`, `tenant_operational_clear_job.py`).

**Product audit (approved ingest/identity plan vs code):**

- Present: endpoint schema/model for `lifecycle_status`, `sample_payload`, `sample_ingested_at` (migration `0030`); nullable `primary_device_key_fields`; strict ingest quarantine for unbound/device-only; MQTT v2 archive path; `v2_resolution` writes v2 rows only when PK fields extract successfully; scope checks vs endpoint row.
- Missing / partial: no workers writing `sample_payload`; lifecycle `needs_sample` / `error` unused; `active` not tied to Scrubber 2.0 publish; CoAP still calls rejected unbound ingest; Scrubber UI not wired to endpoint sample; acceptance tests not covering full flow.

**This commit:** Added `docs/ITERATION_LOG.md` and `.cursor/rules/iteration-log.mdc` so agents append here after substantive edits.

---
