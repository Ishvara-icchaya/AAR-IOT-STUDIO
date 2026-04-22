"""Persisted endpoint lifecycle after successful raw archive (API + workers).

`activation_status` must be one of ``app.core.endpoint_activation.ACTIVATION_STATUS_VALUES``.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


def _norm_protocol_source(ps: str) -> str:
    return (ps or "").strip().lower()


def touch_after_archived_success(db: Session, *, device_id: uuid.UUID, protocol_source: str) -> None:
    """First/last payload timestamps, activation from is_active, clear last_error.

    One endpoint row per device: always touch that row on successful archive. Matching
    ingest protocol_source to endpoint.protocol was brittle (e.g. modbus, future adapters)
    and left last_payload_at stale while raw rows existed — breaking liveness + UI.
    """
    _ = _norm_protocol_source(protocol_source)
    db.execute(
        text(
            """
            UPDATE device_endpoints SET
              last_payload_at = NOW(),
              first_payload_at = COALESCE(first_payload_at, NOW()),
              last_error = NULL,
              activation_status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END
            WHERE device_id = CAST(:did AS uuid)
            """
        ),
        {"did": str(device_id)},
    )
    db.execute(
        text(
            """
            UPDATE devices
            SET last_seen_at = NOW()
            WHERE id = CAST(:did AS uuid)
            """
        ),
        {"did": str(device_id)},
    )


def record_ingest_failure(
    db: Session,
    *,
    device_id: uuid.UUID,
    protocol_source: str,
    message: str,
) -> None:
    _ = _norm_protocol_source(protocol_source)
    msg = (message or "")[:2000]
    db.execute(
        text(
            """
            UPDATE device_endpoints SET
              last_error = :msg,
              activation_status = CASE
                WHEN NOT is_active THEN 'inactive'
                WHEN first_payload_at IS NULL THEN 'error'
                ELSE 'active'
              END
            WHERE device_id = CAST(:did AS uuid)
            """
        ),
        {"did": str(device_id), "msg": msg},
    )


def sync_activation_after_save(ep: Any) -> None:
    """Runtime activation_status from is_active + whether any payload was archived (persisted)."""
    if not ep.is_active:
        ep.activation_status = "inactive"
        return
    if getattr(ep, "first_payload_at", None) is not None:
        ep.activation_status = "active"
    else:
        ep.activation_status = "configured"


def sync_activation_after_validation(
    ep: Any,
    *,
    validation_status: str,
) -> None:
    """Drive activation from validation outcome + payload history (not preview)."""
    if not ep.is_active:
        ep.activation_status = "inactive"
        return
    if validation_status == "failed":
        ep.activation_status = "error"
        return
    has_payload = getattr(ep, "first_payload_at", None) is not None
    if validation_status == "warning" and not has_payload:
        ep.activation_status = "waiting_for_first_payload"
    elif validation_status == "ok" and not has_payload:
        ep.activation_status = "waiting_for_first_payload"
    elif has_payload:
        ep.activation_status = "active"
    else:
        ep.activation_status = "configured"
