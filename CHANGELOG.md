# Changelog

## 6.0.0

**Theme:** Major architecture release — improve **platform liveness** end-to-end: operations command center, resolved default dashboard pipeline, and a clear path toward **Redis-backed serving** with **Postgres as durable truth** and an **API correctness guard**. Product line moves from 5.x to 6.x for breaking and structural changes.

### Liveness architecture verdict (target model — not optional)

Keep this split:

| Layer | Role |
| --- | --- |
| **PostgreSQL** | Durable truth: `devices.last_seen_at`, thresholds, operational flags, persisted `current_liveness_state` for alerts / history / worker reconciliation. |
| **Redis** | Fast serving layer: per-device effective status, rollups, due-scheduler inputs, priority indexes — **not** the source of truth. |
| **API** | Correctness guard: enforce freshness; **never** show stale “online” when timestamps already violate thresholds. |

**Required before scaling Redis liveness (non-negotiable):**

- **Generation / versioning** — e.g. `seen_seq` / monotonic generation on device hashes so ingest and liveness workers cannot let stale writers overwrite fresh state.
- **Atomic rollup strategy** — either a **single rollup writer** (recommended initially: rollup worker only) or **Lua / atomic scripts** for counter mutations; do not assume casual incr/decr stays consistent under retries and double-processing.
- **Cold-start / Redis-flush recovery** — repair or bootstrap path after flush, deploy, or missing keys; steady-state “no full scan” does **not** replace bootstrap.
- **Explicit freshness thresholds + fallback order** — every rollup-style response should carry `asof_ts`, `freshness_ms`, and `status_source`.

**Read fallback order (Redis first, SQL last):**

1. Scope rollup hash **if fresh** (`updated_at` within policy).
2. **Recompute scope from Redis per-device hashes** for that scope (merge site rollups when the user is limited to a subset of sites — do not assume one customer rollup fits all viewers).
3. **Scoped SQL fallback** only when Redis is incomplete, stale, or missing — derive effective status from `last_seen_at` + `late_threshold_seconds` / `offline_threshold_seconds` + active/suppressed flags (same logic as the guard: no `last_seen` → waiting; age vs thresholds → late/offline/online).

**Write authority (refined):**

- **Device hash** (`aar:liveness:v1:device:{id}`): ingest may update `last_seen_ts_ms`, `seen_seq`, due timestamps, and candidate online signal; liveness worker may update `effective_status`, `status_asof_ts_ms`, transition metadata; **all writes** must respect generation / `seen_seq` ordering.
- **Rollups** (`site` / `customer` keys): **single writer** at first (rollup / liveness worker only); ingest does not casually mutate counters without atomic script protection once that rule is relaxed.

**Restart / first-paint behavior:**

- If Postgres survived and Redis is empty or stale: API may serve **recomputed** status from `last_seen_at` + thresholds immediately; background repair **reseeds** device hashes, rollups, and due sets; then reads prefer Redis again.
- New payload after restart: update Postgres `last_seen_at`, refresh Redis device hash / rollups / due times as soon as the write path allows.
- **Do not** rely on persisted `current_liveness_state` alone for first-paint UI when it can disagree with `last_seen_at` age (the mismatch this architecture removes).

**UI / API contract:** Surfaces should consume `effective_liveness_status`, `last_seen_at` / age, `status_source`, and `freshness_ms` — not raw persisted `current_liveness_state` for display correctness.

**Rollout posture (controlled blast radius):** device hash + API guard first → rollups next → due-scheduler / threshold-only steady state after that.

### Shipped in this release (baseline)

- **Dashboard:** Dedicated Operations Overview UI, `command_center` on resolved-live, ingestion time-series hooks, ops widgets and layout integration (foundation for the serving model above; full Redis-first liveness path is incremental work on top of this contract).

## 5.0.0

**Theme:** Tighter UI, better performance, and completing missing application logic across the platform.

- **UI:** Layout and interaction consistency (shell, dashboards, workflow editor, scrubber, monitoring, alerts), clearer hierarchy, and demo-ready polish where it matters most.
- **Performance:** Faster paths for hot operations (e.g. map/dashboard live data, Redis-backed rollups, reduced redundant work in workers and API).
- **Application logic:** End-to-end behavior for operational features previously incomplete or thin (device liveness, health thresholds, field metadata, tenant operational tools, and related API/worker alignment).

Prior releases before v5 are not listed here.
