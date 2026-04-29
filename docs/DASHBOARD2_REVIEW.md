# Dashboard2 review hub — manual verification

Enable the flag in the frontend environment:

```bash
VITE_DASHBOARD2_ENABLED=true
```

## Routes (unchanged legacy)

| Path | Purpose |
|------|---------|
| `/dashboard/:dashboardId/edit` | **Legacy** builder (`DashboardBuilderPage`) — must remain the production editor unless intentionally migrated. |
| `/dashboard/:dashboardId/live` | Legacy live view. |
| `/dashboard2/review` | Review hub: list + actions (flag-gated). |
| `/dashboard2/:id/edit` | Dashboard2 designer. |
| `/dashboard2/:id/live` | Dashboard2 read-only runtime with auto-refresh. |
| `/dashboard2/:id/preview` | Dashboard2 preview. |

## Seeded demo dashboard

On API startup, `ensure_dashboard2_demo_dashboard` runs after bootstrap. It creates **one** draft dashboard named **Demo — Fleet / Map (Dashboard2)** when:

- At least one `sites` row exists,
- At least one `endpoints` row for that site exists,
- Layout validation passes (includes a full-width `map` row per dashboard validation rules).

If no `latest_device_state` row exists yet, `object_name` defaults to `telemetry` in the layout; widgets may show empty states until ingest populates data.

## Suggested smoke checklist (no screenshots stored in-repo)

1. **Review hub**: Open `/dashboard2/review` — list loads, search filters, demo row shows **Demo** pill when seed succeeded.
2. **Open live** on demo — map, KPI, health summary, table render or show intentional empty/loading/error states.
3. **Per-widget refresh time**: After live shell auto-refresh, **Updated HH:MM:SS** in each resolved-collection card header advances.
4. **Map**: Legend (health or lifecycle per `markerColorMode`) and summary overlay visible; excluded GPS count when `require_location` applies.
5. **Navigation**: From live, **Edit** → designer; **Review hub** → list; **Legacy edit** → `/dashboard/:id/edit` (classic UI).
6. **Regression**: Legacy `/dashboard/:id/edit` still loads `DashboardBuilderPage` (not dashboard2).

## Automated checks

- API: `pytest services/api/tests/test_dashboard2_demo_seed.py`
- Frontend: `npm --prefix services/frontend run lint` and `run build`
