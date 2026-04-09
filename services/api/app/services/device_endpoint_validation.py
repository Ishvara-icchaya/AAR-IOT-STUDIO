"""Combine connectivity probe + payload presence for Manage Devices validation run."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.services.device_endpoint_connectivity import run_connectivity_for_protocol
from app.services.device_endpoint_observability import last_raw_ingested_at_iso


def run_endpoint_validation(db: Session, *, protocol: str, config: dict, device_id: UUID) -> tuple[str, str]:
    """Returns (validation_status, validation_detail). status: ok | warning | failed."""
    ok, msg = run_connectivity_for_protocol(protocol, config)
    last_raw = last_raw_ingested_at_iso(db, device_id)
    lines = [f"Connectivity: {msg}"]
    if last_raw:
        lines.append(f"Payload receipt: latest raw archive at {last_raw} (UTC).")
    else:
        lines.append("Payload receipt: no raw object archived for this device yet.")

    if not ok:
        status = "failed"
    elif not last_raw:
        status = "warning"
    else:
        status = "ok"
    return status, "\n".join(lines)


def validation_timestamp() -> datetime:
    return datetime.now(timezone.utc)
