"""Keep v2 `endpoints.auth_config` aligned with Manage Devices MQTT `device_endpoints.config` when linked.

When operators save MQTT settings under Manage Devices, the MQTT bridge and raw archive pipeline expect a
v2 ``endpoints`` row (protocol mqtt) with ``device_endpoint_id`` set. If none exists yet, we create one here
so ingest does not depend on a separate manual Endpoints admin step.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.device_endpoint import DeviceEndpoint
from app.models.device_object import DeviceObject
from app.models.endpoint import Endpoint
from app.services.endpoint_scrubber_semantics_identity_sync import (
    sync_v2_endpoint_identity_from_device_mapping,
)

log = logging.getLogger(__name__)


def ensure_mqtt_v2_endpoint_for_saved_device_endpoint(db: Session, *, device: Device, de: DeviceEndpoint) -> None:
    """Create or refresh the platform MQTT ``endpoints`` row bound to this Manage Devices MQTT row."""
    if (de.protocol or "").strip().lower() != "mqtt":
        return
    cfg = de.config if isinstance(de.config, dict) else {}
    rows = list(
        db.scalars(
            select(Endpoint)
            .where(
                Endpoint.device_endpoint_id == de.id,
                func.lower(func.coalesce(Endpoint.protocol, "")) == "mqtt",
            )
            .order_by(Endpoint.created_at.asc())
        ).all()
    )
    if len(rows) > 1:
        log.warning(
            "multiple v2 MQTT endpoints linked to device_endpoint_id=%s; refreshing the oldest row only",
            de.id,
        )
    if rows:
        v2 = rows[0]
        if not v2.enabled:
            v2.enabled = True
        v2.auth_config = dict(cfg)
        v2.updated_at = datetime.now(timezone.utc)
        db.add(v2)
        log.info("mqtt v2 endpoint config refreshed from Manage Devices save id=%s", v2.id)
        return

    ep_id = uuid.uuid4()
    name_hint = (device.name or "Device").strip() or "Device"
    endpoint_name = f"{name_hint} — MQTT"[:255]
    v2 = Endpoint(
        id=ep_id,
        customer_id=device.customer_id,
        site_id=device.site_id,
        endpoint_name=endpoint_name,
        protocol="mqtt",
        object_name=f"stream_{ep_id.hex}",
        lifecycle_status="active",
        primary_device_key_fields=None,
        device_label_fields=None,
        location_fields=None,
        identity_draft=None,
        auth_config=dict(cfg),
        sample_payload=None,
        device_endpoint_id=de.id,
        enabled=True,
    )
    db.add(v2)
    db.flush()
    do = db.execute(
        select(DeviceObject).where(DeviceObject.device_id == device.id).limit(1)
    ).scalar_one_or_none()
    m = dict(do.mapping) if do and isinstance(do.mapping, dict) else {}
    sync_v2_endpoint_identity_from_device_mapping(
        db,
        device_id=device.id,
        merged_mapping=m,
        device_customer_id=device.customer_id,
    )
    log.info(
        "auto-created v2 MQTT endpoint for Manage Devices row device_endpoint_id=%s v2_endpoint_id=%s",
        de.id,
        v2.id,
    )


def push_mqtt_config_to_linked_v2_endpoint(db: Session, de: DeviceEndpoint) -> None:
    """When `endpoints.device_endpoint_id` points at this row, mirror MQTT `config` into v2 `auth_config`."""
    if (de.protocol or "").strip().lower() != "mqtt":
        return
    v2 = db.execute(
        select(Endpoint).where(Endpoint.device_endpoint_id == de.id)
    ).scalar_one_or_none()
    if v2 is None:
        return
    if (v2.protocol or "").strip().lower() != "mqtt":
        return
    cfg = de.config if isinstance(de.config, dict) else {}
    v2.auth_config = dict(cfg)
    v2.updated_at = datetime.now(timezone.utc)
    db.add(v2)
    log.info(
        "mqtt device_endpoint config mirrored to v2 endpoint device_endpoint_id=%s v2_endpoint_id=%s",
        de.id,
        v2.id,
    )
