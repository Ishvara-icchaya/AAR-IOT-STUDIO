"""Unacknowledged alert summary for header and dashboards."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.services.permission_service import site_ids_with_permission
from app.core.redis_sync import get_redis
from app.models.alert import Alert
from app.models.device import Device
from app.models.user import User
from app.schemas.alert import AlertUnacknowledgedSummary


def unacknowledged_summary(db: Session, user: User) -> AlertUnacknowledgedSummary:
    allowed = site_ids_with_permission(db, user, "devices.read")
    effective_site = func.coalesce(Device.site_id, Alert.site_id)
    filt: list = [
        Alert.customer_id == user.customer_id,
        Alert.acknowledged.is_(False),
    ]
    if allowed is not None:
        if len(allowed) == 0:
            return AlertUnacknowledgedSummary(
                critical=0,
                warning=0,
                info=0,
                informational=0,
                total_unacknowledged=0,
                by_site={},
                has_critical=False,
                critical_recent_count=0,
            )
        filt.append(effective_site.in_(allowed))

    unacked_from = Alert.__table__.outerjoin(Device.__table__, Device.id == Alert.device_id)
    operational_filt = [*filt, Alert.severity.in_(("critical", "warning", "info"))]

    by_site: dict[str, int] = {}
    site_rows = db.execute(
        select(effective_site, func.count())
        .select_from(unacked_from)
        .where(*operational_filt)
        .group_by(effective_site)
    ).all()
    for sid, cnt in site_rows:
        key = str(sid) if sid else "_none"
        by_site[key] = int(cnt)

    def _count_sev(sev: str) -> int:
        return int(
            db.scalar(
                select(func.count()).select_from(unacked_from).where(*filt, Alert.severity == sev)
            )
            or 0
        )

    critical = _count_sev("critical")
    warning = _count_sev("warning")
    info = _count_sev("info")
    informational = _count_sev("informational")
    total_operational = int(
        db.scalar(select(func.count()).select_from(unacked_from).where(*operational_filt)) or 0
    )

    return AlertUnacknowledgedSummary(
        critical=critical,
        warning=warning,
        info=info,
        informational=informational,
        total_unacknowledged=total_operational,
        by_site=by_site,
        has_critical=critical > 0,
        critical_recent_count=critical,
    )


def redis_unacked_hint(customer_id: uuid.UUID) -> int | None:
    r = get_redis()
    if not r:
        return None
    try:
        v = r.get(f"alerts:unacked:count:{customer_id}")
        return int(v) if v is not None else None
    except Exception:
        return None
