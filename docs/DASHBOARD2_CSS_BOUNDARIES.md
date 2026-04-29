# Dashboard 2.0 CSS Boundaries

This note defines strict CSS isolation rules for Dashboard 2.0 rollout.

## Goal

Prevent preview/live layout regressions caused by selector coupling and mixed shell assumptions.

## Hard rule

Never combine live and preview selectors in a single comma-separated CSS rule.

Forbidden pattern example:

```css
.page-card.dash-live-page .dash-widget,
.dash-preview-panel__scroll--fit .dash-widget {
  /* ... */
}
```

Required pattern:

```css
.page-card.dash-live-page .dash-widget {
  /* live-only behavior */
}

.dash-preview-panel__scroll--fit .dash-widget {
  /* preview-only behavior */
}
```

## Namespace direction

Use v2 namespaces for new work:

- `dashboard-designer`
- `dashboard-preview`
- `dashboard-live`
- `dashboard-widget-card`

Keep legacy classes operational, but do not expand cross-context coupling in legacy selectors.

## Guardrail automation

`services/frontend/scripts/check-design-drift.mjs` now fails when it detects live+preview selector coupling in `src/index.css`.

Run:

```bash
npm --prefix services/frontend run lint:design
```
