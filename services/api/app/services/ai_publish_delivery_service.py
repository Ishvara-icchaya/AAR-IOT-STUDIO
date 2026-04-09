"""Published service delivery log trends (metadata Postgres, parameterized ORM only)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models.published_service import PublishedService
from app.models.published_service_delivery_log import PublishedServiceDeliveryLog

_SUCCESS = frozenset({"success", "ok", "delivered", "published", "completed", "succeeded"})


def _is_failure_sql(column):
    """SQL expression: delivery row counts as failure when status not in success set."""
    lowered = func.lower(func.trim(column))
    return case(
        (lowered.in_(list(_SUCCESS)), 0),
        else_=1,
    )


def query_publish_delivery_trends(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_ids: list[uuid.UUID],
    t0: datetime,
    t1: datetime,
    aggregation: str,
    row_limit: int,
    published_service_id: uuid.UUID | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not site_ids:
        return [], {"rows_returned": 0, "reason": "no_sites", "source": "published_delivery_logs"}

    lim = max(1, min(int(row_limit), 500))
    metrics: dict[str, Any] = {"source": "published_delivery_logs", "aggregation": aggregation}
    rows: list[dict[str, Any]] = []

    base_join = PublishedServiceDeliveryLog.published_service_id == PublishedService.id
    base_where = [
        PublishedService.customer_id == customer_id,
        PublishedService.site_id.in_(site_ids),
        PublishedServiceDeliveryLog.published_at >= t0,
        PublishedServiceDeliveryLog.published_at < t1,
    ]
    if published_service_id is not None:
        base_where.append(PublishedService.id == published_service_id)

    if aggregation == "count_by_status":
        cnt = func.count().label("n")
        q = (
            select(PublishedServiceDeliveryLog.status, cnt)
            .select_from(PublishedServiceDeliveryLog)
            .join(PublishedService, base_join)
            .where(*base_where)
            .group_by(PublishedServiceDeliveryLog.status)
            .order_by(cnt.desc())
            .limit(lim)
        )
        for st, n in db.execute(q).all():
            rows.append({"status": st, "count": int(n)})
    elif aggregation == "hourly_failures":
        bucket = func.date_trunc("hour", PublishedServiceDeliveryLog.published_at)
        fail = _is_failure_sql(PublishedServiceDeliveryLog.status)
        q = (
            select(bucket.label("bucket"), func.sum(fail).label("failures"))
            .select_from(PublishedServiceDeliveryLog)
            .join(PublishedService, base_join)
            .where(*base_where)
            .group_by(bucket)
            .order_by(bucket.asc())
            .limit(lim)
        )
        for b, f in db.execute(q).all():
            rows.append(
                {
                    "bucket": b.isoformat() if hasattr(b, "isoformat") else str(b),
                    "failures": int(f or 0),
                }
            )
    else:
        aggregation = "failure_rate_by_service"
        metrics["aggregation"] = aggregation
        fail = _is_failure_sql(PublishedServiceDeliveryLog.status)
        q = (
            select(
                PublishedService.id.label("service_id"),
                PublishedService.name.label("service_name"),
                PublishedService.publish_protocol.label("protocol"),
                func.count().label("total"),
                func.sum(fail).label("failures"),
            )
            .select_from(PublishedServiceDeliveryLog)
            .join(PublishedService, base_join)
            .where(*base_where)
            .group_by(PublishedService.id, PublishedService.name, PublishedService.publish_protocol)
            .having(func.count() > 0)
            .order_by(func.sum(fail).desc())
            .limit(lim)
        )
        for r in db.execute(q).mappings():
            total = int(r["total"] or 0)
            failures = int(r["failures"] or 0)
            rate = round(failures / total, 4) if total else 0.0
            rows.append(
                {
                    "service_id": str(r["service_id"]),
                    "service_name": r["service_name"],
                    "protocol": r["protocol"],
                    "total_deliveries": total,
                    "failures": failures,
                    "failure_rate": rate,
                }
            )

    metrics["rows_returned"] = len(rows)
    if len(rows) >= lim:
        metrics["rows_clamped"] = True
    return rows, metrics
