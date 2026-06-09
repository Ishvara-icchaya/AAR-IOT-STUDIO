"""Resolve the active shared operational cut for default reads (v2 governance)."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device_version import DeviceVersion


def batch_active_operational_device_versions(
    db: Session, *, device_ids: list[uuid.UUID]
) -> dict[uuid.UUID, DeviceVersion]:
    """Best-effort active shared row per device (same ordering as ``active_operational_device_version``)."""
    if not device_ids:
        return {}
    rows = list(
        db.scalars(
            select(DeviceVersion)
            .where(
                DeviceVersion.device_id.in_(device_ids),
                DeviceVersion.routing_lane == "shared",
                DeviceVersion.status == "active",
            )
            .order_by(
                DeviceVersion.device_id,
                DeviceVersion.activated_at.desc().nulls_last(),
                DeviceVersion.created_at.desc(),
            )
        ).all()
    )
    out: dict[uuid.UUID, DeviceVersion] = {}
    for dv in rows:
        if dv.device_id not in out:
            out[dv.device_id] = dv
    return out


def active_operational_device_version(db: Session, *, device_id: uuid.UUID) -> DeviceVersion | None:
    """The single **active** + **shared** ``device_versions`` row for this device, if any."""
    return db.scalars(
        select(DeviceVersion)
        .where(
            DeviceVersion.device_id == device_id,
            DeviceVersion.routing_lane == "shared",
            DeviceVersion.status == "active",
        )
        .order_by(DeviceVersion.activated_at.desc().nulls_last(), DeviceVersion.created_at.desc())
        .limit(1)
    ).first()
