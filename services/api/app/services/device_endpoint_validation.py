"""Combine connectivity probe + payload presence for Manage Devices validation run."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.device_endpoint import DeviceEndpoint
from app.models.endpoint import Endpoint

from app.services.device_endpoint_connectivity import (
    MQTT_LIVE_ERROR,
    MQTT_LIVE_NO_MESSAGE,
    MQTT_LIVE_OK,
    _rest_mode,
    mqtt_subscribe_wait_for_message,
    run_connectivity_for_protocol,
)
from app.services.device_endpoint_observability import assess_payload_receipt_timeliness, last_raw_ingested_at_iso


def _mqtt_archive_explain_lines(db: Session, device_id: UUID) -> list[str]:
    """Why Live MQTT can succeed while raw_data_objects stays empty (API test client vs worker-mqtt-bridge)."""
    de_id = db.scalar(select(DeviceEndpoint.id).where(DeviceEndpoint.device_id == device_id))
    if not de_id:
        return [
            "Archive (MQTT): save a Manage device endpoint first. The live MQTT check runs only on the API — "
            "it does not write to MinIO/Postgres; worker-mqtt-bridge performs archiving."
        ]
    n = db.scalar(
        select(func.count())
        .select_from(Endpoint)
        .where(
            Endpoint.device_endpoint_id == de_id,
            func.lower(Endpoint.protocol) == "mqtt",
            Endpoint.enabled.is_(True),
        )
    )
    if not n:
        return [
            "Archive (MQTT): no enabled v2 MQTT endpoint is linked to this device "
            "(`endpoints.device_endpoint_id` must point at this device’s device_endpoints row). "
            "worker-mqtt-bridge subscribes from v2 `endpoints.auth_config` — without that link, messages are never archived "
            "here even though Validate can read them from the broker."
        ]
    return [
        "Archive (MQTT): Validate only proves the broker delivered a message to this API. "
        "Ingestion is performed by **worker-mqtt-bridge** using the linked v2 MQTT endpoint’s `auth_config` "
        "(same broker/topic as Manage device). If the archive is still empty, check bridge logs and resync (~90s) "
        "after saves, or confirm the v2 row’s topic filter matches what publishers use."
    ]


def run_endpoint_validation(
    db: Session,
    *,
    protocol: str,
    config: dict,
    device_id: UUID,
    polling_interval_seconds: int = 60,
) -> tuple[str, str]:
    """Returns (validation_status, validation_detail). status: ok | warning | failed."""
    logical = (protocol or "").strip().lower()
    if logical in ("http", "https"):
        logical_proto = "rest"
    else:
        logical_proto = logical

    ok, msg = run_connectivity_for_protocol(protocol, config)
    mqtt_live_kind: str | None = None
    mqtt_live_detail = ""
    if logical_proto == "mqtt" and ok and isinstance(config, dict):
        mqtt_live_kind, mqtt_live_detail = mqtt_subscribe_wait_for_message(config)
        if mqtt_live_kind == MQTT_LIVE_ERROR:
            ok = False
            msg = f"{msg}; {mqtt_live_detail}" if msg else mqtt_live_detail

    last_raw = last_raw_ingested_at_iso(db, device_id)
    device = db.get(Device, device_id)
    late_thr = int(getattr(device, "late_threshold_seconds", None) or 120) if device else 120

    lines = [f"Connectivity: {msg}"]
    if mqtt_live_detail and mqtt_live_kind in (MQTT_LIVE_OK, MQTT_LIVE_NO_MESSAGE):
        lines.append(f"Live MQTT: {mqtt_live_detail}")
    if last_raw:
        lines.append(f"Payload receipt: latest raw archive at {last_raw} (UTC).")
    else:
        lines.append("Payload receipt: no raw object archived for this device yet.")
        p = (protocol or "").lower()
        if logical_proto == "mqtt":
            lines.extend(_mqtt_archive_explain_lines(db, device_id))
        elif p in ("http", "https", "rest") and isinstance(config, dict):
            rm = _rest_mode(config)
            if rm != "polling":
                lines.append(
                    "REST Push (Push to Platform): the platform does not poll an upstream URL. "
                    "Upstream systems POST to `/api/v1/ingest/raw` when they have data."
                )
            else:
                lines.append(
                    "REST Pull (Pull from Upstream): worker-rest-poller polls the configured URL — if archives stay "
                    "empty, confirm the worker is running and check its logs (idle = no matching endpoint rows)."
                )

    receipt = assess_payload_receipt_timeliness(
        last_raw_ingested_at=last_raw,
        late_threshold_seconds=late_thr,
        logical_protocol=logical_proto,
        config=config if isinstance(config, dict) else {},
        polling_interval_column=polling_interval_seconds,
    )
    if last_raw and receipt["status"] == "stale":
        age = receipt.get("age_seconds")
        thr = receipt.get("threshold_seconds")
        rest_pull = (
            logical_proto == "rest"
            and isinstance(config, dict)
            and _rest_mode(config) == "polling"
        )
        tail = " and REST Pull poll/timeout cadence)." if rest_pull else ")."
        lines.append(
            "Payload receipt: no new archived raw within the configured timeliness window "
            f"(~{age}s since last raw vs threshold {thr}s — matches device liveness late threshold{tail}"
        )

    if not ok:
        status = "failed"
    elif logical_proto == "mqtt" and ok and mqtt_live_kind == MQTT_LIVE_NO_MESSAGE:
        status = "warning"
    elif not last_raw:
        status = "warning"
    elif receipt["status"] == "stale":
        status = "warning"
    else:
        status = "ok"
    return status, "\n".join(lines)


def validation_timestamp() -> datetime:
    return datetime.now(timezone.utc)
