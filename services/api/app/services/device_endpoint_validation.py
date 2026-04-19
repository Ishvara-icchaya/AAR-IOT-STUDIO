"""Combine connectivity probe + payload presence for Manage Devices validation run."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.device import Device

from app.services.device_endpoint_connectivity import _rest_mode, run_connectivity_for_protocol
from app.services.device_endpoint_observability import assess_payload_receipt_timeliness, last_raw_ingested_at_iso


def run_endpoint_validation(
    db: Session,
    *,
    protocol: str,
    config: dict,
    device_id: UUID,
    polling_interval_seconds: int = 60,
) -> tuple[str, str]:
    """Returns (validation_status, validation_detail). status: ok | warning | failed."""
    ok, msg = run_connectivity_for_protocol(protocol, config)
    last_raw = last_raw_ingested_at_iso(db, device_id)
    device = db.get(Device, device_id)
    late_thr = int(getattr(device, "late_threshold_seconds", None) or 120) if device else 120
    logical = (protocol or "").strip().lower()
    if logical in ("http", "https"):
        logical_proto = "rest"
    else:
        logical_proto = logical

    lines = [f"Connectivity: {msg}"]
    if last_raw:
        lines.append(f"Payload receipt: latest raw archive at {last_raw} (UTC).")
    else:
        lines.append("Payload receipt: no raw object archived for this device yet.")
        p = (protocol or "").lower()
        if p in ("http", "https", "rest") and isinstance(config, dict):
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
    elif not last_raw:
        status = "warning"
    elif receipt["status"] == "stale":
        status = "warning"
    else:
        status = "ok"
    return status, "\n".join(lines)


def validation_timestamp() -> datetime:
    return datetime.now(timezone.utc)
