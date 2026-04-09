from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, user_may_access_site
from app.core.alert_category import ALLOWED_ALERT_CATEGORIES
from app.core.alert_severity import normalize_severity
from app.models.alert import Alert
from app.models.user import User
from app.schemas.alert import AlertListResponse, AlertRead
from app.services.alert_emit import reconcile_unacked_redis


class AlertAccessDenied(Exception):
    """Alert missing or belongs to another customer (treat as 404)."""


class AlertForbidden(Exception):
    """Valid tenant but operator cannot access this alert (403)."""


def _may_view_alert(db: Session, user: User, a: Alert) -> bool:
    if a.customer_id != user.customer_id:
        return False
    allowed = allowed_site_ids_for_user(db, user)
    if allowed is None:
        return True
    if a.site_id is None:
        return False
    return user_may_access_site(user, a.site_id, allowed)


def require_alert(db: Session, user: User, alert_id: uuid.UUID) -> Alert:
    a = db.get(Alert, alert_id)
    if not a or a.customer_id != user.customer_id:
        raise AlertAccessDenied()
    if not _may_view_alert(db, user, a):
        raise AlertForbidden()
    return a


def _alert_filters(
    db: Session,
    user: User,
    *,
    site_id: uuid.UUID | None,
    severity: str | None,
    category: str | None,
    acknowledged: bool | None,
    search: str | None,
):
    allowed = allowed_site_ids_for_user(db, user)
    parts: list = [Alert.customer_id == user.customer_id]
    if allowed is not None and len(allowed) == 0:
        return None
    if allowed is not None:
        parts.append(Alert.site_id.in_(allowed))
    if site_id is not None:
        parts.append(Alert.site_id == site_id)
    if severity:
        parts.append(Alert.severity == normalize_severity(severity))
    if category and category in ALLOWED_ALERT_CATEGORIES:
        parts.append(Alert.category == category)
    if acknowledged is True:
        parts.append(Alert.acknowledged.is_(True))
    elif acknowledged is False:
        parts.append(Alert.acknowledged.is_(False))
    if search and search.strip():
        q = f"%{search.strip()}%"
        parts.append(or_(Alert.title.ilike(q), Alert.message.ilike(q)))
    return parts


def list_alerts(
    db: Session,
    user: User,
    *,
    site_id: uuid.UUID | None = None,
    severity: str | None = None,
    category: str | None = None,
    acknowledged: bool | None = None,
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> AlertListResponse:
    parts = _alert_filters(
        db,
        user,
        site_id=site_id,
        severity=severity,
        category=category,
        acknowledged=acknowledged,
        search=search,
    )
    if parts is None:
        return AlertListResponse(items=[], total=0)

    stmt = select(Alert).where(*parts)
    total = int(db.scalar(select(func.count()).select_from(Alert).where(*parts)) or 0)
    rows = list(
        db.scalars(
            stmt.order_by(Alert.created_at.desc()).limit(limit).offset(offset)
        ).all()
    )
    return AlertListResponse(
        items=[AlertRead.model_validate(r) for r in rows],
        total=total,
    )


def acknowledge_alert(db: Session, user: User, alert_id: uuid.UUID) -> Alert:
    a = require_alert(db, user, alert_id)
    if a.acknowledged:
        return a
    a.acknowledged = True
    a.acknowledged_at = datetime.now(timezone.utc)
    a.acknowledged_by_user_id = user.id
    db.add(a)
    db.commit()
    db.refresh(a)
    reconcile_unacked_redis(db, customer_id=user.customer_id)
    return a
