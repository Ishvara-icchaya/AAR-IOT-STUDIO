# AAR system layer (`components/system`)

Atomic UI primitives and global **design tokens** (`src/styles/design-tokens.css`). Use this layer for reusable controls, surfaces, and typography — not for full list-page composition.

## Token philosophy

- **`--aar-*`**: canonical design tokens (colors, spacing, radius, type, shadows, status). Defined once on `:root` in `design-tokens.css`.
- **`--dm-*`**: legacy alias used by Manage Devices / ops tables. On ops shells (see `device-register-page.css`), `--dm-*` maps to `var(--aar-*)` so existing pages keep working while new code prefers `--aar-*`.
- Import `design-tokens.css` and `aar-components.css` only from app entry (`main.tsx`), not per page.

## Approved colors (new UI)

Prefer semantic tokens:

- Surfaces: `--aar-bg`, `--aar-surface`, `--aar-surface-2`, `--aar-surface-3`
- Borders: `--aar-border`, `--aar-border-strong`
- Text: `--aar-text`, `--aar-muted`
- Accents: `--aar-accent-blue`, `--aar-accent-green`, `--aar-accent-amber`, `--aar-accent-red`, `--aar-accent-purple`
- Status: `--aar-status-online`, `--aar-status-degraded`, `--aar-status-offline`, `--aar-status-error`, `--aar-status-draft`, `--aar-status-active`

Avoid raw hex / ad-hoc rgba in new TS/CSS except documented exceptions (e.g. chart series, third-party overrides).

## Spacing scale (8px rhythm)

`--aar-space-1` … `--aar-space-8` — use for padding and gaps on new work. Ops list rhythm should stay aligned with existing `OpsListPage` spacing until a coordinated migration.

## Radius scale

- Buttons / inputs: `--aar-radius-md`
- Cards / panels: `--aar-radius-lg`
- Modals / drawers: `--aar-radius-xl`

## Button variants (`AarButton`)

Maps to the shared `dm-btn` system used across ops:

- `primary` → `dm-btn dm-btn--primary`
- `outline` → `dm-btn dm-btn--outline`
- `danger` → `dm-btn dm-btn--danger`
- `warning` → `dm-btn dm-btn--warning`

## Status and badges

- **Row / entity status** in ops tables: use **`OpsStatusPill`** (wraps `AarStatusPill` with the approved ops subset).
- **Extended lifecycle states** (active, draft, published, frozen, disabled, warning, valid, invalid, waiting, …): use **`AarStatusPill`** with the full `AarStatusVariant` union.
- **Compact meta badges** (modes, tags): use **`AarPill`** (`neon` | `warn` | `muted` | `bad`), not `dm-pill`.

## When to use system vs ops

| Need | Use |
|------|-----|
| List page layout (header → scope → KPI → filters → table → pager) | `components/ops` (`OpsListPage`, …) |
| Buttons, inputs, cards, toolbar, table shell, page header blocks | `components/system` |
| Row icon actions on ops tables | `OpsActionButton` (uses `dm-act-grid__btn`) |

**Rule:** New **ops landing pages** must use **`OpsListPage`** primitives. New **atomic UI** should use **`Aar*`** components and **`--aar-*`** tokens.

## Enforcement

- `npm run lint` — ESLint (includes guardrails against `dm-pill` / `dm-table-pager__btn` strings in TS/TSX; Scrubber 2 editor path excluded).
- `npm run lint:design` — `scripts/check-design-drift.mjs` (native dialogs, legacy classes, `scrubber2-btn` outside editor). Optional: `DESIGN_DRIFT_STRICT=1` fails on hex in `src/pages` TS/TSX.
