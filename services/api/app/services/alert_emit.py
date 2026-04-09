"""Canonical alert creation (DB + optional Redis mirrors)."""

from __future__ import annotations

import json
import logging
import uuid
from sqlalchemy.orm import Session

from app.core.alert_category import normalize_alert_category
from app.core.alert_severity import normalize_severity
from app.core.redis_sync import get_redis
from app.models.alert import Alert

log = logging.getLogger(__name__)

CRITICAL_SEVERITY = "critical"


def emit_alert(
    *,
    db: Session,
    category: str,
    severity: str,
    title: str,
    message: str | None = None,
    customer_id: uuid.UUID,
    site_id: uuid.UUID | None = None,
    device_id: uuid.UUID | None = None,
    source_component: str | None = None,
    source_object_type: str | None = None,
    source_object_id: uuid.UUID | None = None,
    trace_id: str | None = None,
) -> Alert:
    sev = normalize_severity(severity)
    cat = normalize_alert_category(category)
    row = Alert(
        id=uuid.uuid4(),
        customer_id=customer_id,
        site_id=site_id,
        device_id=device_id,
        category=cat,
        severity=sev[:16],
        title=title[:255],
        message=(message or "")[:20000],
        source_component=(source_component[:100] if source_component else None),
        source_object_type=(source_object_type[:64] if source_object_type else None),
        source_object_id=source_object_id,
        trace_id=(trace_id[:128] if trace_id else None),
        acknowledged=False,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _mirror_redis(db, row)
    log.debug(
        "alert emitted id=%s category=%s severity=%s",
        row.id,
        row.category,
        row.severity,
    )
    return row


def _mirror_redis(db: Session, row: Alert) -> None:
    r = get_redis()
    if not r:
        return
    cid = str(row.customer_id)
    try:
        reconcile_unacked_redis(db, customer_id=row.customer_id)
        if (row.severity or "").lower() == CRITICAL_SEVERITY:
            blob = json.dumps(
                {
                    "id": str(row.id),
                    "title": row.title,
                    "category": row.category,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "customer_id": cid,
                },
                default=str,
            )
            r.lpush("alerts:latest:critical", blob)
            r.ltrim("alerts:latest:critical", 0, 99)
    except Exception:
        log.debug("redis mirror failed for alert", exc_info=True)


def reconcile_unacked_redis(db: Session, *, customer_id: uuid.UUID) -> None:
    """Rebuild customer + per-site unacked counters from DB (e.g. after acknowledge)."""
    from sqlalchemy import func, select

    r = get_redis()
    if not r:
        return
    try:
        total = db.scalar(
            select(func.count())
            .select_from(Alert)
            .where(Alert.customer_id == customer_id, Alert.acknowledged.is_(False))
        )
        r.set(f"alerts:unacked:count:{customer_id}", int(total or 0))
        rows = db.execute(
            select(Alert.site_id, func.count())
            .where(Alert.customer_id == customer_id, Alert.acknowledged.is_(False))
            .group_by(Alert.site_id)
        ).all()
        for sid, cnt in rows:
            if sid is not None:
                r.set(f"alerts:unacked:site:{sid}", int(cnt))
    except Exception:
        log.debug("redis reconcile failed", exc_info=True)
