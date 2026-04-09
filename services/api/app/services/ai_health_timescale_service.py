"""TimescaleDB health_history reads for Enterprise AI (parameterized SQL only)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import timescale_engine
from app.services.ai_kpi_timescale_service import clamp_window, list_device_ids_for_sites

log = logging.getLogger(__name__)

_STATUS_EXPR = (
    "COALESCE(NULLIF(trim(hh.record->>'health_status'), ''), "
    "NULLIF(trim(hh.record->>'status'), ''), 'unknown')"
)
_SCORE_EXPR = (
    "CASE "
    "WHEN jsonb_typeof(hh.record->'health_score') = 'number' "
    "THEN (hh.record->>'health_score')::double precision "
    "WHEN jsonb_typeof(hh.record->'score') = 'number' "
    "THEN (hh.record->>'score')::double precision "
    "ELSE NULL END"
)


def query_health_trends(
    metadata_db: Session,
    *,
    customer_id: uuid.UUID,
    site_ids: list[uuid.UUID],
    t0: datetime,
    t1: datetime,
    aggregation: str,
    row_limit: int,
    statement_timeout_ms: int | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    dev_ids = list_device_ids_for_sites(metadata_db, customer_id=customer_id, site_ids=site_ids)
    if not dev_ids:
        return [], {"rows_returned": 0, "reason": "no_devices_in_sites", "source": "timescale_health"}

    t0u = t0 if t0.tzinfo else t0.replace(tzinfo=timezone.utc)
    t1u = t1 if t1.tzinfo else t1.replace(tzinfo=timezone.utc)
    t0u, t1u, span_clamped = clamp_window(t0u, t1u)
    lim = max(1, min(int(row_limit), int(settings.ai_kpi_trend_max_rows)))

    agg = aggregation
    if agg not in (
        "hourly_status_counts",
        "daily_status_counts",
        "hourly_avg_score",
        "daily_avg_score",
        "recent_points",
    ):
        agg = "daily_status_counts" if (t1u - t0u) > timedelta(days=2) else "hourly_status_counts"

    metrics: dict[str, Any] = {
        "source": "timescale_health",
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
                stmt = text(
                    f"""
                    SELECT hh.time AS t, hh.device_id::text AS device_id,
                           left(hh.record::text, 500) AS record_preview
                    FROM health_history hh
                    WHERE hh.customer_id = CAST(:cid AS uuid)
                      AND hh.time >= :t0 AND hh.time < :t1
                      AND hh.device_id IS NOT NULL
                      AND hh.device_id IN :dev_ids
                    ORDER BY hh.time DESC
                    LIMIT :lim
                    """
                ).bindparams(bindparam("dev_ids", expanding=True))
                result = conn.execute(stmt, {"cid": cid, "t0": t0u, "t1": t1u, "dev_ids": dev_ids, "lim": lim})
            elif agg == "hourly_status_counts":
                stmt = text(
                    f"""
                    SELECT time_bucket(INTERVAL '1 hour', hh.time) AS bucket,
                           {_STATUS_EXPR} AS health_status,
                           count(*)::int AS n
                    FROM health_history hh
                    WHERE hh.customer_id = CAST(:cid AS uuid)
                      AND hh.time >= :t0 AND hh.time < :t1
                      AND hh.device_id IS NOT NULL
                      AND hh.device_id IN :dev_ids
                    GROUP BY 1, 2
                    ORDER BY 1 ASC, 2 ASC
                    LIMIT :lim
                    """
                ).bindparams(bindparam("dev_ids", expanding=True))
                result = conn.execute(stmt, {"cid": cid, "t0": t0u, "t1": t1u, "dev_ids": dev_ids, "lim": lim})
            elif agg == "daily_status_counts":
                stmt = text(
                    f"""
                    SELECT time_bucket(INTERVAL '1 day', hh.time) AS bucket,
                           {_STATUS_EXPR} AS health_status,
                           count(*)::int AS n
                    FROM health_history hh
                    WHERE hh.customer_id = CAST(:cid AS uuid)
                      AND hh.time >= :t0 AND hh.time < :t1
                      AND hh.device_id IS NOT NULL
                      AND hh.device_id IN :dev_ids
                    GROUP BY 1, 2
                    ORDER BY 1 ASC, 2 ASC
                    LIMIT :lim
                    """
                ).bindparams(bindparam("dev_ids", expanding=True))
                result = conn.execute(stmt, {"cid": cid, "t0": t0u, "t1": t1u, "dev_ids": dev_ids, "lim": lim})
            elif agg == "hourly_avg_score":
                stmt = text(
                    f"""
                    SELECT time_bucket(INTERVAL '1 hour', hh.time) AS bucket,
                           avg({_SCORE_EXPR}) AS avg_score,
                           count(*)::int AS n
                    FROM health_history hh
                    WHERE hh.customer_id = CAST(:cid AS uuid)
                      AND hh.time >= :t0 AND hh.time < :t1
                      AND hh.device_id IS NOT NULL
                      AND hh.device_id IN :dev_ids
                      AND {_SCORE_EXPR} IS NOT NULL
                    GROUP BY 1
                    HAVING avg({_SCORE_EXPR}) IS NOT NULL
                    ORDER BY 1 ASC
                    LIMIT :lim
                    """
                ).bindparams(bindparam("dev_ids", expanding=True))
                result = conn.execute(stmt, {"cid": cid, "t0": t0u, "t1": t1u, "dev_ids": dev_ids, "lim": lim})
            else:
                stmt = text(
                    f"""
                    SELECT time_bucket(INTERVAL '1 day', hh.time) AS bucket,
                           avg({_SCORE_EXPR}) AS avg_score,
                           count(*)::int AS n
                    FROM health_history hh
                    WHERE hh.customer_id = CAST(:cid AS uuid)
                      AND hh.time >= :t0 AND hh.time < :t1
                      AND hh.device_id IS NOT NULL
                      AND hh.device_id IN :dev_ids
                      AND {_SCORE_EXPR} IS NOT NULL
                    GROUP BY 1
                    HAVING avg({_SCORE_EXPR}) IS NOT NULL
                    ORDER BY 1 ASC
                    LIMIT :lim
                    """
                ).bindparams(bindparam("dev_ids", expanding=True))
                result = conn.execute(stmt, {"cid": cid, "t0": t0u, "t1": t1u, "dev_ids": dev_ids, "lim": lim})

            for r in result.mappings():
                row = dict(r)
                if row.get("t") is not None and hasattr(row["t"], "isoformat"):
                    row["t"] = row["t"].isoformat()
                if row.get("bucket") is not None and hasattr(row["bucket"], "isoformat"):
                    row["bucket"] = row["bucket"].isoformat()
                if row.get("avg_score") is not None:
                    row["avg_score"] = float(row["avg_score"])
                rows.append(row)
    except Exception:
        log.exception("health_history timescale query failed")
        raise

    metrics["rows_returned"] = len(rows)
    if len(rows) >= lim:
        metrics["rows_clamped"] = True
    return rows, metrics
