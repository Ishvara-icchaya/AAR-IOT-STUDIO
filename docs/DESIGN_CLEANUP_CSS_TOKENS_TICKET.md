# Ticket: Design system cleanup — CSS tokens and component ownership

**Status:** **In progress** — tranche 1 landed (canonical `.aar-btn` + `dm-btn` aliases, pager migration, lint/design drift, [`FRONTEND_DESIGN_COMPONENTS.md`](./FRONTEND_DESIGN_COMPONENTS.md)). Further call-site migration and dead-CSS removal continue incrementally.  
**Problem statement:** Duplication and conflicting ownership across CSS namespaces, not a single broken top-nav style.

---

## Context (dashboard edit UI review)

The app currently mixes many parallel styling systems (`aar-*`, `dm-*`, `op-*`, `scrubber2-*`, `ops-*`, `dash-*`, plus page-local overrides). That increases drift, regressions, and review cost. This ticket defines the target architecture and follow-up work so refactors can be incremental and intentional.

---

## Principles (action items from review)

### 1. No new page-specific CSS

Do not add more one-off page styles. Prefer shared primitives and existing layout shells. New work should extend the canonical token layer and shared components, not introduce another page-scoped stylesheet pattern.

### 2. `aar-*` as the only token source for new CSS

- **New CSS** must use **`aar-*`** tokens / utilities.
- **`dm-*`** may remain only as **compatibility aliases** mapping to `aar-*` (or documented equivalents); do not grow new `dm-*` surface for new features.

### 3. Legacy freeze (do not extend)

Treat the following as **legacy — frozen** (fix bugs if required; do not copy patterns into new code):

- `dm-pill`
- `op-table-pager__btn`
- `scrubber2-btn`
- Page-specific button styles (ad hoc `.page … button` / local class stacks)

### 4. Replacement targets (migrate usage over time)

| Legacy / ad hoc | Prefer |
|-----------------|--------|
| Raw buttons / `dm-*` / `scrubber2-btn` / page-local buttons | **`AarButton`**, **`OpsActionButton`** |
| `dm-pill` / ad hoc status chips | **`AarStatusPill`**, **`OpsStatusPill`** |
| Tables + pager one-offs | **`OpsDataTable`** |
| List-style pages with bespoke layout | **`OpsListPage`** |

Migration is **gradual**; frozen classes stay until call sites are replaced.

### 5. Top navigation — deprioritize churn

Current CSS intentionally sets **full width** (e.g. `.aar-topnav { width: 100%; max-width: none; }` and shell wrapper behavior). **Do not keep reworking nav** unless screenshots or QA still show breakage after other changes.

### 6. Priority order

Biggest issue: **CSS duplication and unclear ownership**, not hunting a single broken class. Cleanup should reduce namespaces and centralize tokens before polishing isolated pixels.

---

## Next pass (scoped follow-up work)

1. **Remove unused legacy selectors** — ongoing: duplicate **button** rules were removed from `device-register-page.css` (canonical copy in `aar-primitives.css`). Continue per-area audits for orphaned `op-*` / `dash-*` rules.
2. **Policy / lint** — **Done for pager + pills:** ESLint `no-restricted-syntax` and `npm run lint:design` forbid `op-table-pager__btn` (and existing `dm-pill` / `dm-table-pager__btn`). Broader `dm-btn` ban deferred (high call-site volume).
3. **Documentation** — **Done:** [`FRONTEND_DESIGN_COMPONENTS.md`](./FRONTEND_DESIGN_COMPONENTS.md) lists list pages, tables, buttons, status, modals, and enforcement commands.

---

## Out of scope (for this ticket)

- v2 endpoint runtime validation work, unless a UI issue **blocks** completing that validation.
- Rewriting top navigation layout without new evidence of breakage.

---

## References

- Design tokens / primitives: `services/frontend/src/components/system/aar-primitives.css` (and related `aar-*` usage).
- Iteration discipline: `docs/ITERATION_LOG.md` (log significant cleanups when executed).
