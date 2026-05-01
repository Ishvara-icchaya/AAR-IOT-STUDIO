"""Keep v2 `endpoints.auth_config` aligned with Manage Devices MQTT `device_endpoints.config` when linked.

The MQTT bridge also subscribes from unlinked `device_endpoints` directly; when a v2 row is linked,
mirroring keeps `auth_config` in sync for operators and legacy tooling.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device_endpoint import DeviceEndpoint
from app.models.endpoint import Endpoint

log = logging.getLogger(__name__)


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
