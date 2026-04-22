"""Mirror API lifecycle updates using psycopg2 (workers)."""

from __future__ import annotations

import logging
import uuid

log = logging.getLogger(__name__)


def _norm_protocol_source(ps: str) -> str:
    return (ps or "").strip().lower()


def touch_after_archived_success(cur, device_id: uuid.UUID, protocol_source: str) -> None:
    _ = _norm_protocol_source(protocol_source)
    cur.execute(
        """
        UPDATE device_endpoints SET
          last_payload_at = NOW(),
          first_payload_at = COALESCE(first_payload_at, NOW()),
          last_error = NULL,
          activation_status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END
        WHERE device_id = %s::uuid
        """,
        (str(device_id),),
    )
    cur.execute(
        """
        UPDATE devices
        SET last_seen_at = NOW()
        WHERE id = %s::uuid
        """,
        (str(device_id),),
    )


def record_ingest_failure(cur, device_id: uuid.UUID, protocol_source: str, message: str) -> None:
    _ = _norm_protocol_source(protocol_source)
    msg = (message or "")[:2000]
    cur.execute(
        """
        UPDATE device_endpoints SET
          last_error = %s,
          activation_status = CASE
            WHEN NOT is_active THEN 'inactive'
            WHEN first_payload_at IS NULL THEN 'error'
            ELSE 'active'
          END
        WHERE device_id = %s::uuid
        """,
        (msg, str(device_id)),
    )
