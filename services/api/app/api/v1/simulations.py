"""Phase 10 — replay simulation jobs."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.device import Device
from app.models.user import User
from app.schemas.simulation import ReplaySimulationCreate, SimulationJobRead
from app.services.permission_service import ensure_site_permission
from app.services.replay_simulation_service import create_and_run_replay_job, get_simulation_job

router = APIRouter()


def _load_device_for_tenant(db: Session, device_id: uuid.UUID, customer_id: uuid.UUID) -> Device | None:
    d = db.get(Device, device_id)
    if not d or d.customer_id != customer_id:
        return None
    return d


@router.post("/replay", response_model=SimulationJobRead, status_code=status.HTTP_201_CREATED)
def run_replay_simulation(
    body: ReplaySimulationCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    device = _load_device_for_tenant(db, body.device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    allowed = allowed_site_ids_for_user(db, user)
    if allowed is not None and device.site_id not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Device not visible for this user")
    ensure_site_permission(db, user, device.site_id, "simulation.run")
    job = create_and_run_replay_job(
        db,
        user,
        device_id=body.device_id,
        candidate_device_version_id=body.candidate_device_version_id,
        baseline_device_version_id=body.baseline_device_version_id,
        scope_hours=body.scope_hours,
        sample_size=body.sample_size,
    )
    db.commit()
    db.refresh(job)
    return SimulationJobRead.model_validate(job)


@router.get("/{job_id}", response_model=SimulationJobRead)
def get_replay_simulation_job(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = get_simulation_job(db, user, job_id)
    return SimulationJobRead.model_validate(job)
