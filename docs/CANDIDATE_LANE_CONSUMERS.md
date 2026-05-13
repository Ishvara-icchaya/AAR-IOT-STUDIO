# Candidate lane: `candidate_latest_device_state` consumers

This document lists **who reads or depends on** the candidate-lane mirror of device state (`candidate_latest_device_state`), separate from the shared production row (`latest_device_state`).

## Writer (ingestion path)

- **Worker resolution (`services/workers/app/v2_resolution.py`)** — When the active `device_versions` row for a resolved device is on the **candidate** routing lane (and the cut is non-terminal), the worker **upserts** `candidate_latest_device_state` via `upsert_candidate_latest_device_state` in `services/workers/app/candidate_lane.py`.
- When the version is **shared** / production, the same pipeline updates **`latest_device_state`** instead; candidate and shared paths are mutually exclusive for a given resolved device at steady state.

## Intended consumers (today)

| Consumer | Role |
|----------|------|
| **Replay simulation (API)** | Uses historical `scrubbed_events` and static impact analysis; does **not** read `candidate_latest_device_state` directly today, but aligns with the same “candidate cut” story for OTA / promote flows. |
| **Operational / support tooling** | SQL / admin inspection of candidate KPIs and `display_json` while a device version is isolated before promote. |

## Planned / downstream integrations

These are **not** wired as first-class product features yet; they are the natural consumers called out in the platform roadmap:

1. **Dashboard live read path** — Optional binding or toggle to resolve KPI/chart widgets against **candidate** state for a device in `simulation_required` or `candidate` lane OTA phases (guarded by RBAC).
2. **OTA wizard & campaign simulation** — Surface “candidate vs shared” diffs using the same resolved identity, optionally joining `candidate_latest_device_state` with replay job results.
3. **External analytics / exports** — Batch jobs that compare `latest_device_state` vs `candidate_latest_device_state` for shadow validation.

## Related tables

- `candidate_scrubbed_events` — Candidate-lane scrub output keyed by `device_version_id`.
- `candidate_workflow_results` — Optional workflow payloads for candidate cuts.

## RBAC note

Reading candidate state in the **control plane** should stay behind explicit permissions (e.g. `device_versions.read`, `simulation.run`, future `candidate_state.read`) once dashboard or API exposure lands; today the primary interface is the worker write path plus DB access.
