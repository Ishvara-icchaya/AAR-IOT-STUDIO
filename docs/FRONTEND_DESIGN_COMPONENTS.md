# Frontend design system — components and CSS policy

This document is the **canonical reference** for new UI in `services/frontend`. It implements the dashboard / ops UI review backlog (principles 1–6). Details also live in [`DESIGN_CLEANUP_CSS_TOKENS_TICKET.md`](./DESIGN_CLEANUP_CSS_TOKENS_TICKET.md).

---

## 1. No new page-specific CSS

Avoid new per-page stylesheets and ad hoc `.page-name …` overrides for buttons, tables, and status. Prefer shared tokens (`aar-*`), `aar-components.css`, and the components below.

## 2. Token source: `aar-*` first; `dm-*` as compatibility

- **New CSS** should use **`var(--aar-*)`** and **`.aar-*`** class names where primitives exist.
- **`--dm-*` / `.dm-*`** remain **aliases** on ops shells (see `device-register-page.css` token maps and `aar-primitives.css`). Do not add new `dm-*` patterns for greenfield UI.

## 3. Legacy (frozen — do not extend)

Do not copy these into new code; migrate call sites when touching an area:

| Legacy | Notes |
|--------|--------|
| `dm-pill` | Use **`AarPill`** |
| `op-table-pager__btn` | Use **`AarButton`** + `.op-table-pager__action` (see `PlainOperationalTable`) |
| `scrubber2-btn` | Reserved for Scrubber 2 editor under `src/pages/scrubber2/` only (`npm run lint:design`) |
| Page-local button stacks | Use **`AarButton`** / **`OpsActionButton`** |

## 4. Required building blocks

| Use case | Component | Location |
|----------|-----------|----------|
| List / ops chrome (header, filters, KPI strip) | **`OpsListPage`** (+ `OpsPageHeader`, `OpsFilterPanel`, `OpsKpiRow`) | `@/components/ops/` |
| Device / ops data tables | **`OpsDataTable`** | `@/components/ops/OpsDataTable.tsx` |
| Generic dense table + client pager | **`PlainOperationalTable`** | `@/components/data/PlainOperationalTable.tsx` |
| Primary / outline / danger / warning actions | **`AarButton`** | `@/components/system/AarButton.tsx` |
| Icon / grid row actions (tables) | **`OpsActionButton`** | `@/components/ops/OpsActionButton.tsx` |
| Status text chips | **`OpsStatusPill`** (wraps **`AarStatusPill`**) | `@/components/ops/OpsStatusPill.tsx` |
| Compact meta badges | **`AarPill`** | `@/components/system/` |

**Links styled as primary buttons:** use the same classes as `AarButton` emits, e.g. `className="aar-btn aar-btn--primary dm-btn dm-btn--primary"` (see `DashboardListPage`).

## 5. Top navigation

`.aar-topnav` and shell width are **intentionally full width**. Do not rework global nav unless QA shows a real regression.

## 6. Priorities when refactoring

Reduce **duplicate CSS and unclear ownership** before pixel-level polish. Prefer moving shared rules into `aar-primitives.css` and deleting duplicates from page CSS.

---

## Modals and destructive actions

- **Confirm / warn dialogs:** `useConfirmAction()` from `@/contexts/ConfirmActionContext` and **`ConfirmActionModal`** (`@/components/app/ConfirmActionModal.tsx`). Do not use `window.confirm` / `alert` / `prompt` (enforced by `npm run lint:design`).
- **Other modals:** follow existing patterns (Radix / local backdrop) in the feature area; prefer reusing the same focus and dismiss behavior as `ConfirmActionModal` when adding new flows.

---

## Enforcement

| Check | Command |
|-------|---------|
| ESLint (includes banned legacy class **literals** in TS/TSX) | `npm run lint` |
| Design drift (native dialogs, legacy pills/pager, `scrubber2-btn` outside editor, optional strict hex) | `npm run lint:design` |

Scrubber 2 editor path `src/pages/scrubber2/**` disables some ESLint `no-restricted-syntax` rules so the editor can keep legacy markup where needed; `lint:design` still restricts `scrubber2-btn` **outside** that folder.

---

## Canonical stylesheet load order

Import from app entry only (`main.tsx`): `design-tokens.css`, `aar-components.css` (which pulls `aar-primitives.css`). Button primitives for **`.aar-btn` + `.dm-btn`** live in **`aar-primitives.css`**; ops pages may still import `device-register-page.css` for layout and `--dm-*` scope maps without redefining base buttons.
