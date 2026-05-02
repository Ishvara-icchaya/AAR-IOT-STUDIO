"""TimescaleDB kpi_history reads for Enterprise AI (parameterized SQL only)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import bindparam, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import timescale_engine
from app.models.device import Device

log = logging.getLogger(__name__)


def list_device_ids_for_sites(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_ids: list[uuid.UUID],
) -> list[uuid.UUID]:
    if not site_ids:
        return []
    return list(
        db.scalars(
            select(Device.id).where(Device.customer_id == customer_id, Device.site_id.in_(site_ids))
        ).all()
    )


def sanitize_kpi_keys(raw: Any, *, max_keys: int = 24, max_len: int = 64) -> list[str] | None:
    if raw is None:
        return None
    if isinstance(raw, str) and raw.strip():
        return [raw.strip()[:max_len]]
    if not isinstance(raw, list):
        return None
    out: list[str] = []
    for x in raw[:max_keys]:
        s = str(x).strip()[:max_len]
        if s:
            out.append(s)
    return out or None


def clamp_window(t0: datetime, t1: datetime) -> tuple[datetime, datetime, bool]:
    """Clamp [t0,t1) to max AI KPI trend span."""
    max_d = timedelta(days=max(1, int(settings.ai_kpi_trend_max_days)))
    if t1 <= t0:
        t0 = t1 - timedelta(hours=1)
    if (t1 - t0) <= max_d:
        return t0, t1, False
    return t1 - max_d, t1, True


def query_kpi_trends(
    metadata_db: Session,
    *,
    customer_id: uuid.UUID,
    site_ids: list[uuid.UUID],
    t0: datetime,
    t1: datetime,
    aggregation: str,
    row_limit: int,
    kpi_keys: list[str] | None,
    statement_timeout_ms: int | None = None,
    restrict_device_ids: list[uuid.UUID] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    base_dev_ids = list_device_ids_for_sites(metadata_db, customer_id=customer_id, site_ids=site_ids)
    dev_ids = base_dev_ids
    if restrict_device_ids:
        allow = set(restrict_device_ids)
        dev_ids = [d for d in dev_ids if d in allow]
    if not dev_ids:
        if restrict_device_ids and base_dev_ids:
            return [], {"rows_returned": 0, "reason": "device_filter_no_match", "source": "timescale"}
        return [], {"rows_returned": 0, "reason": "no_devices_in_sites", "source": "timescale"}

    t0u = t0 if t0.tzinfo else t0.replace(tzinfo=timezone.utc)
    t1u = t1 if t1.tzinfo else t1.replace(tzinfo=timezone.utc)
    t0u, t1u, span_clamped = clamp_window(t0u, t1u)

    lim = max(1, min(int(row_limit), int(settings.ai_kpi_trend_max_rows)))

    agg = aggregation
    if agg not in ("hourly_avg_by_key", "daily_avg_by_key", "recent_points"):
        agg = "daily_avg_by_key" if (t1u - t0u) > timedelta(days=2) else "hourly_avg_by_key"

    metrics: dict[str, Any] = {
        "source": "timescale",
        "aggregation": agg,
        "span_clamped": span_clamped,
        "device_scope_count": len(dev_ids),
    }

    rows: list[dict[str, Any]] = []

    try:
        with timescale_engine.connect() as conn:
            if statement_timeout_ms and statement_timeout_ms > 0:
                conn.execute(
                    text("SET LOCAL statement_timeout = :st"),
                    {"st": f"{int(statement_timeout_ms)}ms"},
                )
            cid = str(customer_id)
            if agg == "recent_points":
                if kpi_keys:
                    stmt = text(
                        """
                        SELECT kh.time AS t, kh.kpi_key, kh.value, kh.device_id::text AS device_id
                        FROM kpi_history kh
                        WHERE kh.customer_id = CAST(:cid AS uuid)
                          AND kh.time >= :t0 AND kh.time < :t1
                          AND kh.device_id IN :dev_ids
                          AND kh.kpi_key IN :kkeys
                        ORDER BY kh.time DESC
                        LIMIT :lim
                        """
                    ).bindparams(bindparam("dev_ids", expanding=True), bindparam("kkeys", expanding=True))
                    result = conn.execute(
                        stmt,
                        {"cid": cid, "t0": t0u, "t1": t1u, "dev_ids": dev_ids, "kkeys": kpi_keys, "lim": lim},
                    )
                else:
                    stmt = text(
                        """
                        SELECT kh.time AS t, kh.kpi_key, kh.value, kh.device_id::text AS device_id
                        FROM kpi_history kh
                        WHERE kh.customer_id = CAST(:cid AS uuid)
                          AND kh.time >= :t0 AND kh.time < :t1
                          AND kh.device_id IN :dev_ids
                        ORDER BY kh.time DESC
                        LIMIT :lim
                        """
                    ).bindparams(bindparam("dev_ids", expanding=True))
                    result = conn.execute(
                        stmt, {"cid": cid, "t0": t0u, "t1": t1u, "dev_ids": dev_ids, "lim": lim}
                    )
            elif agg == "hourly_avg_by_key":
                if kpi_keys:
                    stmt = text(
                        """
                        SELECT time_bucket(INTERVAL '1 hour', kh.time) AS bucket,
                               kh.kpi_key,
                               avg(kh.value) AS avg_value,
                               count(*)::int AS sample_count
                        FROM kpi_history kh
                        WHERE kh.customer_id = CAST(:cid AS uuid)
                          AND kh.time >= :t0 AND kh.time < :t1
                          AND kh.device_id IN :dev_ids
                          AND kh.kpi_key IN :kkeys
                        GROUP BY 1, 2
                        ORDER BY 1 ASC, 2 ASC
                        LIMIT :lim
                        """
                    ).bindparams(bindparam("dev_ids", expanding=True), bindparam("kkeys", expanding=True))
                    result = conn.execute(
                        stmt,
                        {"cid": cid, "t0": t0u, "t1": t1u, "dev_ids": dev_ids, "kkeys": kpi_keys, "lim": lim},
                    )
                else:
                    stmt = text(
                        """
                        SELECT time_bucket(INTERVAL '1 hour', kh.time) AS bucket,
                               kh.kpi_key,
                               avg(kh.value) AS avg_value,
                               count(*)::int AS sample_count
                        FROM kpi_history kh
                        WHERE kh.customer_id = CAST(:cid AS uuid)
                          AND kh.time >= :t0 AND kh.time < :t1
                          AND kh.device_id IN :dev_ids
                        GROUP BY 1, 2
                        ORDER BY 1 ASC, 2 ASC
                        LIMIT :lim
                        """
                    ).bindparams(bindparam("dev_ids", expanding=True))
                    result = conn.execute(
                        stmt, {"cid": cid, "t0": t0u, "t1": t1u, "dev_ids": dev_ids, "lim": lim}
                    )
            else:
                if kpi_keys:
                    stmt = text(
                        """
                        SELECT time_bucket(INTERVAL '1 day', kh.time) AS bucket,
                               kh.kpi_key,
                               avg(kh.value) AS avg_value,
                               count(*)::int AS sample_count
                        FROM kpi_history kh
                        WHERE kh.customer_id = CAST(:cid AS uuid)
                          AND kh.time >= :t0 AND kh.time < :t1
                          AND kh.device_id IN :dev_ids
                          AND kh.kpi_key IN :kkeys
                        GROUP BY 1, 2
                        ORDER BY 1 ASC, 2 ASC
                        LIMIT :lim
                        """
                    ).bindparams(bindparam("dev_ids", expanding=True), bindparam("kkeys", expanding=True))
                    result = conn.execute(
                        stmt,
                        {"cid": cid, "t0": t0u, "t1": t1u, "dev_ids": dev_ids, "kkeys": kpi_keys, "lim": lim},
                    )
                else:
                    stmt = text(
                        """
                        SELECT time_bucket(INTERVAL '1 day', kh.time) AS bucket,
                               kh.kpi_key,
                               avg(kh.value) AS avg_value,
                               count(*)::int AS sample_count
                        FROM kpi_history kh
                        WHERE kh.customer_id = CAST(:cid AS uuid)
                          AND kh.time >= :t0 AND kh.time < :t1
                          AND kh.device_id IN :dev_ids
                        GROUP BY 1, 2
                        ORDER BY 1 ASC, 2 ASC
                        LIMIT :lim
                        """
                    ).bindparams(bindparam("dev_ids", expanding=True))
                    result = conn.execute(
                        stmt, {"cid": cid, "t0": t0u, "t1": t1u, "dev_ids": dev_ids, "lim": lim}
                    )

            for r in result.mappings():
                row = dict(r)
                if row.get("t") is not None and hasattr(row["t"], "isoformat"):
                    row["t"] = row["t"].isoformat()
                if row.get("bucket") is not None and hasattr(row["bucket"], "isoformat"):
                    row["bucket"] = row["bucket"].isoformat()
                rows.append(row)
    except Exception:
        log.exception("kpi_history timescale query failed")
        raise

    metrics["rows_returned"] = len(rows)
    if len(rows) >= lim:
        metrics["rows_clamped"] = True
    return rows, metrics
