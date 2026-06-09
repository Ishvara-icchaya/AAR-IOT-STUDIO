"""Phase 10 — replay simulation over historical scrubbed events (MVP: structural + KPI fidelity)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.device_version import DeviceVersion
from app.models.endpoint import Endpoint
from app.models.resolved_device import ResolvedDevice
from app.models.scrubbed_event import ScrubbedEvent
from app.models.simulation_job import SimulationJob
from app.models.user import User
from app.services.device_version_impact_service import build_static_impact_payload
from app.services.permission_service import ensure_site_permission

log = logging.getLogger(__name__)


def _resolved_device_id_for_device(db: Session, device: Device) -> uuid.UUID | None:
    ep_de = device.endpoint
    if ep_de is None:
        return None
    endpoint_id = db.scalar(select(Endpoint.id).where(Endpoint.device_endpoint_id == ep_de.id).limit(1))
    if endpoint_id is None:
        return None
    return db.scalar(select(ResolvedDevice.id).where(ResolvedDevice.endpoint_id == endpoint_id).limit(1))


def _audit_replay_job(db: Session, user: User, device: Device, job: SimulationJob) -> None:
    from app.services.control_plane_audit_service import emit_control_plane_audit

    emit_control_plane_audit(
        db,
        customer_id=user.customer_id,
        site_id=device.site_id,
        actor_user_id=user.id,
        action_type="replay_simulation_completed",
        resource_type="simulation_job",
        resource_id=job.id,
        payload_json={
            "status": job.status,
            "records_tested": job.records_tested,
            "records_passed": job.records_passed,
            "records_failed": job.records_failed,
            "device_id": str(device.id),
            "error_message": job.error_message,
        },
    )


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _top_keys(d: dict[str, Any] | None) -> frozenset[str]:
    if not isinstance(d, dict):
        return frozenset()
    return frozenset(str(k) for k in d.keys())


def _kpi_numeric_delta(oldest: dict[str, Any] | None, newest: dict[str, Any] | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    o = oldest if isinstance(oldest, dict) else {}
    n = newest if isinstance(newest, dict) else {}
    for k in set(o) | set(n):
        vo, vn = o.get(k), n.get(k)
        if isinstance(vo, (int, float)) and isinstance(vn, (int, float)):
            out[str(k)] = {"oldest": vo, "newest": vn, "delta": float(vn) - float(vo)}
    return out


def _display_field_diff(
    oldest_display: dict[str, Any] | None, newest_display: dict[str, Any] | None
) -> list[dict[str, Any]]:
    o = _top_keys(oldest_display if isinstance(oldest_display, dict) else None)
    n = _top_keys(newest_display if isinstance(newest_display, dict) else None)
    added = sorted(n - o)
    removed = sorted(o - n)
    rows: list[dict[str, Any]] = []
    for f in added:
        rows.append({"field": f, "change": "added_in_newer_sample"})
    for f in removed:
        rows.append({"field": f, "change": "removed_in_newer_sample"})
    return rows


def _recommendation(
    *,
    pass_rate: float,
    impact_notes: list[dict[str, Any]],
    tested: int,
) -> str:
    if tested == 0:
        return "No scrubbed samples in the selected window; widen the window or confirm ingest for this resolved device."
    parts = [f"Replay structural pass rate {pass_rate:.0%} over {tested} record(s)."]
    if impact_notes:
        parts.append("Static graph flagged schema or binding risk — review workflow and dashboard lists before rollout.")
    else:
        parts.append("No static schema-version dashboard warnings from impact analysis.")
    if pass_rate >= 0.95:
        parts.append("Recommendation: candidate pipeline shape aligns with recent production scrub output; proceed with staged OTA.")
    elif pass_rate >= 0.75:
        parts.append("Recommendation: mixed fidelity — tighten scrubber/workflow diff or reduce sample skew before wide rollout.")
    else:
        parts.append("Recommendation: low fidelity vs latest scrub signature — do not promote without remediation.")
    return " ".join(parts)


def create_and_run_replay_job(
    db: Session,
    user: User,
    *,
    device_id: uuid.UUID,
    candidate_device_version_id: uuid.UUID | None,
    baseline_device_version_id: uuid.UUID | None,
    scope_hours: int,
    sample_size: int,
) -> SimulationJob:
    """Sample scrubbed_events for the device's resolved identity; compare shape vs newest sample (candidate proxy)."""
    device = db.get(Device, device_id)
    if not device or device.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    ensure_site_permission(db, user, device.site_id, "simulation.run")

    cap = max(10, min(int(sample_size), 2000))
    hours = max(1, min(int(scope_hours), 24 * 90))
    window_end = _utcnow()
    window_start = window_end - timedelta(hours=hours)

    cand = None
    if candidate_device_version_id is not None:
        cand = db.get(DeviceVersion, candidate_device_version_id)
        if not cand or cand.device_id != device.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "candidate_device_version_id invalid for this device")
    if cand is None:
        cand = db.scalars(
            select(DeviceVersion)
            .where(DeviceVersion.device_id == device.id)
            .order_by(DeviceVersion.created_at.desc(), DeviceVersion.id.desc())
            .limit(1)
        ).first()
    if cand is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No device_versions row for this device")

    baseline_dv = None
    if baseline_device_version_id is not None:
        baseline_dv = db.get(DeviceVersion, baseline_device_version_id)
        if not baseline_dv or baseline_dv.device_id != device.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "baseline_device_version_id invalid for this device")

    rd = _resolved_device_id_for_device(db, device)
    job = SimulationJob(
        id=uuid.uuid4(),
        customer_id=user.customer_id,
        site_id=device.site_id,
        device_id=device.id,
        created_by=user.id,
        baseline_device_version_id=baseline_dv.id if baseline_dv else None,
        candidate_device_version_id=cand.id,
        window_start=window_start,
        window_end=window_end,
        sample_size=cap,
        records_tested=0,
        records_passed=0,
        records_failed=0,
        status="running",
        error_message=None,
        result_json=None,
        created_at=_utcnow(),
        completed_at=None,
    )
    db.add(job)
    db.flush()

    if rd is None:
        job.status = "failed"
        job.error_message = "No resolved_device for this device endpoint; cannot sample scrubbed_events."
        job.completed_at = _utcnow()
        db.add(job)
        db.flush()
        _audit_replay_job(db, user, device, job)
        return job

    rows = list(
        db.scalars(
            select(ScrubbedEvent)
            .where(
                ScrubbedEvent.resolved_device_id == rd,
                ScrubbedEvent.customer_id == user.customer_id,
                ScrubbedEvent.event_ts >= window_start,
                ScrubbedEvent.event_ts <= window_end,
            )
            .order_by(ScrubbedEvent.event_ts.desc(), ScrubbedEvent.id.desc())
            .limit(cap)
        ).all()
    )

    if not rows:
        job.records_tested = 0
        job.status = "completed"
        impact = build_static_impact_payload(db, customer_id=user.customer_id, device=device, candidate=cand)
        rec = _recommendation(pass_rate=0.0, impact_notes=impact.get("notes") or [], tested=0)
        job.result_json = {
            "field_diff": [],
            "kpi_delta": {},
            "workflow_impact": impact.get("workflows") or [],
            "dashboard_impact": impact.get("dashboards") or [],
            "recommendation": rec,
            "resolved_device_id": str(rd),
            "note": "No scrubbed rows in window",
        }
        job.completed_at = _utcnow()
        db.add(job)
        db.flush()
        _audit_replay_job(db, user, device, job)
        return job

    reference = rows[0]
    ref_keys = _top_keys(reference.display_json if isinstance(reference.display_json, dict) else None)
    passed = 0
    failed = 0
    for r in rows:
        rk = _top_keys(r.display_json if isinstance(r.display_json, dict) else None)
        if rk == ref_keys:
            passed += 1
        else:
            failed += 1

    oldest = rows[-1]
    newest = rows[0]
    field_diff = _display_field_diff(
        oldest.display_json if isinstance(oldest.display_json, dict) else None,
        newest.display_json if isinstance(newest.display_json, dict) else None,
    )
    kpi_delta = _kpi_numeric_delta(
        oldest.kpi_json if isinstance(oldest.kpi_json, dict) else None,
        newest.kpi_json if isinstance(newest.kpi_json, dict) else None,
    )
    impact = build_static_impact_payload(db, customer_id=user.customer_id, device=device, candidate=cand)
    tested = len(rows)
    pass_rate = (passed / tested) if tested else 0.0
    rec = _recommendation(pass_rate=pass_rate, impact_notes=impact.get("notes") or [], tested=tested)

    job.records_tested = tested
    job.records_passed = passed
    job.records_failed = failed
    job.status = "completed"
    job.result_json = {
        "field_diff": field_diff,
        "kpi_delta": kpi_delta,
        "workflow_impact": impact.get("workflows") or [],
        "dashboard_impact": impact.get("dashboards") or [],
        "recommendation": rec,
        "resolved_device_id": str(rd),
        "reference_scrubbed_event_id": str(reference.id),
        "oldest_sample_ts": oldest.event_ts.isoformat(),
        "newest_sample_ts": newest.event_ts.isoformat(),
    }
    job.completed_at = _utcnow()
    db.add(job)
    db.flush()
    _audit_replay_job(db, user, device, job)
    log.info("replay simulation job id=%s device=%s tested=%s pass=%s", job.id, device.id, tested, passed)
    return job


def get_simulation_job(db: Session, user: User, job_id: uuid.UUID) -> SimulationJob:
    job = db.get(SimulationJob, job_id)
    if not job or job.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Simulation job not found")
    ensure_site_permission(db, user, job.site_id, "simulation.run")
    return job
