"""Shared vs candidate pipeline rules (Phase 7)."""

from __future__ import annotations

import uuid

from sqlalchemy import not_, select
from sqlalchemy.orm import Session

from app.models.device_endpoint import DeviceEndpoint
from app.models.device_version import DeviceVersion
from app.models.endpoint import Endpoint
from app.models.resolved_device import ResolvedDevice

CANDIDATE_LANE = "candidate"
SHARED_LANE = "shared"

_TERMINAL_DV = frozenset({"failed", "rolled_back", "deprecated"})


def resolved_device_blocked_from_shared_latest(db: Session, resolved_device_id: uuid.UUID) -> tuple[bool, uuid.UUID | None]:
    """Return (True, device_version_id) when a candidate-lane version blocks shared ``latest_device_state`` writes."""
    row = db.execute(
        select(DeviceVersion.id)
        .select_from(ResolvedDevice)
        .join(Endpoint, Endpoint.id == ResolvedDevice.endpoint_id)
        .join(DeviceEndpoint, DeviceEndpoint.id == Endpoint.device_endpoint_id)
        .join(DeviceVersion, DeviceVersion.device_id == DeviceEndpoint.device_id)
        .where(
            ResolvedDevice.id == resolved_device_id,
            DeviceVersion.routing_lane == CANDIDATE_LANE,
            not_(DeviceVersion.status.in_(tuple(_TERMINAL_DV))),
        )
        .limit(1)
    ).first()
    if not row:
        return False, None
    return True, row[0]
