"""Resolve which ``device_versions`` row governs default operational reads (active + shared).

Callers attach the result to dashboards, map, trends, and footprint responses. Optional
``device_version_id`` selects an explicit cut (candidate lane body, or audit-only rows).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import Enum

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.candidate_lane import CandidateLatestDeviceState
from app.models.device import Device
from app.models.device_endpoint import DeviceEndpoint
from app.models.device_version import DeviceVersion
from app.models.endpoint import Endpoint
from app.models.resolved_device import ResolvedDevice
from app.services.device_version_operational_service import active_operational_device_version
from app.services.routing_policy import CANDIDATE_LANE, SHARED_LANE

_TERMINAL_DV = frozenset({"failed", "rolled_back", "deprecated"})


class LiveReadLane(str, Enum):
    shared_lds = "shared_lds"
    candidate_lds = "candidate_lds"
    unavailable = "unavailable"


@dataclass(frozen=True)
class ResolvedOperationalRead:
    """Per ``resolved_device`` read policy for version-governed live surfaces."""

    device_id: uuid.UUID | None
    effective_shared_active_id: uuid.UUID | None
    pinned_device_version_id: uuid.UUID | None
    live_read_lane: LiveReadLane
    pinned_version: DeviceVersion | None


def device_id_for_resolved_device(db: Session, resolved_device_id: uuid.UUID) -> uuid.UUID | None:
    row = db.execute(
        select(Device.id)
        .select_from(ResolvedDevice)
        .join(Endpoint, Endpoint.id == ResolvedDevice.endpoint_id)
        .join(DeviceEndpoint, DeviceEndpoint.id == Endpoint.device_endpoint_id)
        .where(ResolvedDevice.id == resolved_device_id)
        .limit(1)
    ).first()
    return row[0] if row and row[0] else None


def batch_effective_shared_device_version_ids(
    db: Session, *, customer_id: uuid.UUID, resolved_device_ids: list[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID | None]:
    """Map ``resolved_device_id`` → active shared ``device_versions.id`` (same customer)."""
    out: dict[uuid.UUID, uuid.UUID | None] = {rid: None for rid in resolved_device_ids}
    if not resolved_device_ids:
        return out
    pairs = db.execute(
        select(ResolvedDevice.id, Device.id)
        .join(Endpoint, Endpoint.id == ResolvedDevice.endpoint_id)
        .join(DeviceEndpoint, DeviceEndpoint.id == Endpoint.device_endpoint_id)
        .join(Device, Device.id == DeviceEndpoint.device_id)
        .where(
            ResolvedDevice.id.in_(resolved_device_ids),
            ResolvedDevice.customer_id == customer_id,
            Device.customer_id == customer_id,
        )
    ).all()
    rd_to_dev: dict[uuid.UUID, uuid.UUID] = {p[0]: p[1] for p in pairs}
    dev_ids = list({d for d in rd_to_dev.values()})
    if not dev_ids:
        return out
    best: dict[uuid.UUID, uuid.UUID] = {}
    for did in dev_ids:
        adv = active_operational_device_version(db, device_id=did)
        if adv is not None:
            best[did] = adv.id
    for rd, did in rd_to_dev.items():
        out[rd] = best.get(did)
    return out


def resolve_operational_read_for_resolved_device(
    db: Session,
    *,
    customer_id: uuid.UUID,
    resolved_device_id: uuid.UUID,
    explicit_device_version_id: uuid.UUID | None,
) -> ResolvedOperationalRead:
    rd = db.get(ResolvedDevice, resolved_device_id)
    if not rd:
        raise LookupError("resolved_device")
    if rd.customer_id != customer_id:
        raise PermissionError("resolved_device")

    device_id = device_id_for_resolved_device(db, resolved_device_id)
    active = active_operational_device_version(db, device_id=device_id) if device_id else None
    eff = active.id if active else None

    if device_id is not None:
        dev = db.get(Device, device_id)
        if not dev or dev.customer_id != customer_id:
            device_id = None
            eff = None

    if not explicit_device_version_id:
        return ResolvedOperationalRead(
            device_id=device_id,
            effective_shared_active_id=eff,
            pinned_device_version_id=None,
            live_read_lane=LiveReadLane.shared_lds,
            pinned_version=None,
        )

    dv = db.get(DeviceVersion, explicit_device_version_id)
    if not dv or device_id is None or dv.device_id != device_id:
        raise LookupError("device_version")

    dev = db.get(Device, dv.device_id)
    if not dev or dev.customer_id != customer_id:
        raise PermissionError("device_version")

    lane: LiveReadLane
    if dv.routing_lane == CANDIDATE_LANE and dv.status not in _TERMINAL_DV:
        crow = db.scalar(
            select(CandidateLatestDeviceState).where(
                CandidateLatestDeviceState.resolved_device_id == resolved_device_id,
                CandidateLatestDeviceState.device_version_id == dv.id,
            )
        )
        lane = LiveReadLane.candidate_lds if crow is not None else LiveReadLane.unavailable
    elif dv.status == "active" and dv.routing_lane == SHARED_LANE:
        lane = LiveReadLane.shared_lds
    else:
        lane = LiveReadLane.unavailable

    return ResolvedOperationalRead(
        device_id=device_id,
        effective_shared_active_id=eff,
        pinned_device_version_id=dv.id,
        live_read_lane=lane,
        pinned_version=dv,
    )


def governance_dict(ctx: ResolvedOperationalRead) -> dict[str, str | None]:
    return {
        "effectiveDeviceVersionId": str(ctx.effective_shared_active_id) if ctx.effective_shared_active_id else None,
        "pinnedDeviceVersionId": str(ctx.pinned_device_version_id) if ctx.pinned_device_version_id else None,
        "liveReadLane": ctx.live_read_lane.value,
    }


def candidate_latest_row(
    db: Session, *, resolved_device_id: uuid.UUID, device_version_id: uuid.UUID
) -> CandidateLatestDeviceState | None:
    return db.scalar(
        select(CandidateLatestDeviceState).where(
            CandidateLatestDeviceState.resolved_device_id == resolved_device_id,
            CandidateLatestDeviceState.device_version_id == device_version_id,
        )
    )
