"""Timescale map_object_kpi_history reads for map marker detail."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import bindparam, text

from app.db.session import timescale_engine

log = logging.getLogger(__name__)


def query_map_kpi_recent(
    *,
    customer_id: uuid.UUID,
    object_kind: str,
    object_id: uuid.UUID,
    hours: float,
    kpi_keys: list[str] | None,
    row_limit: int = 200,
) -> list[dict[str, Any]]:
    t1 = datetime.now(timezone.utc)
    t0 = t1 - timedelta(hours=hours)

    cid = str(customer_id)
    oid = str(object_id)
    kind = str(object_kind)
    lim = max(1, min(int(row_limit), 500))

    try:
        with timescale_engine.connect() as conn:
            if kpi_keys:
                stmt = text(
                    """
                    SELECT time AS t, kpi_key, value, record
                    FROM map_object_kpi_history
                    WHERE customer_id = CAST(:cid AS uuid)
                      AND object_kind = :kind
                      AND object_id = CAST(:oid AS uuid)
                      AND time >= :t0 AND time < :t1
                      AND kpi_key IN :kkeys
                    ORDER BY time DESC
                    LIMIT :lim
                    """
                ).bindparams(bindparam("kkeys", expanding=True))
                result = conn.execute(
                    stmt,
                    {"cid": cid, "kind": kind, "oid": oid, "t0": t0, "t1": t1, "kkeys": kpi_keys, "lim": lim},
                )
            else:
                result = conn.execute(
                    text(
                        """
                        SELECT time AS t, kpi_key, value, record
                        FROM map_object_kpi_history
                        WHERE customer_id = CAST(:cid AS uuid)
                          AND object_kind = :kind
                          AND object_id = CAST(:oid AS uuid)
                          AND time >= :t0 AND time < :t1
                        ORDER BY time DESC
                        LIMIT :lim
                        """
                    ),
                    {"cid": cid, "kind": kind, "oid": oid, "t0": t0, "t1": t1, "lim": lim},
                )
            rows: list[dict[str, Any]] = []
            for row in result.mappings():
                r = dict(row)
                t = r.get("t")
                rows.append(
                    {
                        "t": t.isoformat().replace("+00:00", "Z") if hasattr(t, "isoformat") else str(t),
                        "kpi_key": r.get("kpi_key"),
                        "value": r.get("value"),
                        "record": r.get("record") or {},
                    }
                )
            return rows
    except Exception:
        log.exception("map_object_kpi_history query failed")
        return []
