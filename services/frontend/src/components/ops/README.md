# Ops List Page Standards

Use these primitives for every operations landing page (`Manage Devices`, `Workflows`, `Scrubber Pipelines`, `Dashboards`, and future siblings).

## Mandatory rules (do not break)

- **All list pages** in this product area must compose **`OpsListPage`** (no bespoke page shells that reimplement the same sections).
- **No page** may introduce its own:
  - custom KPI layout (use `OpsKpiRow` / shared KPI classes),
  - custom filter row chrome (use `OpsFilterPanel`),
  - custom table wrapper chrome (use `OpsDataTable` / `dm-table-wrap` via ops),
  - one-off pager button classes (use `dm-table-pager` + `dm-btn dm-btn--outline` only).
- **All row icon actions** must use **`OpsActionButton`**.
- **All row status display** on these pages must use **`OpsStatusPill`** (backed by `AarStatusPill` / design tokens).
- **Do not** use in TS/TSX: `dm-pill`, `dm-table-pager__btn`, `op-table-pager__btn`, native `window.confirm` / `alert` / `prompt`, or `scrubber2-btn` outside `src/pages/scrubber2/`. (Enforced by ESLint + `npm run lint:design`.)

For tokens and atomic components, see `src/components/system/README.md`.

## Allowed Page Structure

Compose pages with `OpsListPage` in this fixed order:

1. `OpsPageHeader` (title, subtitle, top-right actions)
2. `OpsScopeBar` (site, duration, refresh)
3. `OpsKpiRow` (summary cards)
4. `OpsFilterPanel` (search + filters + row actions)
5. `OpsDataTable` (table/content + empty state)
6. Pagination footer (`dm-table-pager` with metadata + controls)

Do not introduce page-local wrappers that change spacing, section order, or table chrome.

## Approved Button Variants

- Primary action: `dm-btn dm-btn--primary`
- Secondary action: `dm-btn dm-btn--outline`
- Danger action: `dm-btn dm-btn--danger`
- Row/icon actions: `OpsActionButton` only (`tone`: `default` | `plain` | `danger`)
- Disabled actions: native `disabled` attribute on the same approved classes/components

## Approved Status Pill Variants

Use `OpsStatusPill` only. Approved variants:

- `online`
- `degraded`
- `offline`
- `error`
- `muted`

Avoid page-local status badge implementations for migrated ops pages.

## Pagination Pattern

Use one footer pattern across ops pages:

- Left: result metadata text (`showing X-Y of Z`)
- Right: controls in `dm-table-pager__controls`
- Buttons: `dm-btn dm-btn--outline` for previous/next

Do not create page-specific pager button styles.

## Rule for New Ops Pages

New ops landing pages must use `OpsListPage` primitives from this directory.
If a new layout need appears, extend shared ops components/styles first rather than adding one-off page CSS.
