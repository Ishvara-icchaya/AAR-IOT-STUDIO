# Changelog

## 6.0.0

**Theme:** Major architecture release — operations command center, resolved default dashboard pipeline, and serving-layer groundwork aligned with Redis-backed rollups (Postgres remains durable truth).

- **Dashboard:** Dedicated Operations Overview UI, `command_center` payload on resolved-live, ingestion time-series support, and expanded ops widgets and layout engine integration.
- **Versioning:** Product line moves from 5.x to 6.x to reflect breaking and structural changes across API and frontend packaging.

## 5.0.0

**Theme:** Tighter UI, better performance, and completing missing application logic across the platform.

- **UI:** Layout and interaction consistency (shell, dashboards, workflow editor, scrubber, monitoring, alerts), clearer hierarchy, and demo-ready polish where it matters most.
- **Performance:** Faster paths for hot operations (e.g. map/dashboard live data, Redis-backed rollups, reduced redundant work in workers and API).
- **Application logic:** End-to-end behavior for operational features previously incomplete or thin (device liveness, health thresholds, field metadata, tenant operational tools, and related API/worker alignment).

Prior releases before v5 are not listed here.
