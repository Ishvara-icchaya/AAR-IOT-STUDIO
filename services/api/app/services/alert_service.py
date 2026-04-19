from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, user_may_access_site
from app.core.alert_category import ALLOWED_ALERT_CATEGORIES
from app.core.alert_severity import normalize_severity
from app.models.alert import Alert
from app.models.device import Device
from app.models.site import Site
from app.models.user import User
from app.schemas.alert import AlertListResponse, AlertRead
from app.services.alert_emit import reconcile_unacked_redis


class AlertAccessDenied(Exception):
    """Alert missing or belongs to another customer (treat as 404)."""


class AlertForbidden(Exception):
    """Valid tenant but operator cannot access this alert (403)."""


def _effective_platform_site_id(db: Session, a: Alert) -> uuid.UUID | None:
    """Tenant site that owns the ingesting device when present; else site stored on the alert row."""
    if a.device_id:
        d = db.get(Device, a.device_id)
        if d is not None and d.customer_id == a.customer_id:
            return d.site_id
    return a.site_id


def _may_view_alert(db: Session, user: User, a: Alert) -> bool:
    if a.customer_id != user.customer_id:
        return False
    allowed = allowed_site_ids_for_user(db, user)
    if allowed is None:
        return True
    eff = _effective_platform_site_id(db, a)
    if eff is None:
        return False
    return user_may_access_site(user, eff, allowed)


def require_alert(db: Session, user: User, alert_id: uuid.UUID) -> Alert:
    a = db.get(Alert, alert_id)
    if not a or a.customer_id != user.customer_id:
        raise AlertAccessDenied()
    if not _may_view_alert(db, user, a):
        raise AlertForbidden()
    return a


def _alert_filter_parts(
    db: Session,
    user: User,
    *,
    site_id: uuid.UUID | None,
    severity: str | None,
    category: str | None,
    acknowledged: bool | None,
    search: str | None,
) -> tuple[list, object] | None:
    """Returns (where_parts, effective_site_expr) or None if no rows may be returned."""
    allowed = allowed_site_ids_for_user(db, user)
    effective_site = func.coalesce(Device.site_id, Alert.site_id)
    parts: list = [Alert.customer_id == user.customer_id]
    if allowed is not None and len(allowed) == 0:
        return None
    if allowed is not None:
        parts.append(effective_site.in_(allowed))
    if site_id is not None:
        parts.append(effective_site == site_id)
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
    return parts, effective_site


def _alert_base_join():
    return select(Alert).outerjoin(Device, Device.id == Alert.device_id)


def _enrich_alert_rows(db: Session, rows: list[Alert]) -> list[AlertRead]:
    if not rows:
        return []
    dev_ids = [a.device_id for a in rows if a.device_id]
    devices_by_id: dict[uuid.UUID, Device] = {}
    if dev_ids:
        for d in db.scalars(select(Device).where(Device.id.in_(dev_ids))):
            devices_by_id[d.id] = d
    site_ids: set[uuid.UUID] = set()
    for a in rows:
        if a.device_id and a.device_id in devices_by_id:
            site_ids.add(devices_by_id[a.device_id].site_id)
        elif a.site_id:
            site_ids.add(a.site_id)
    site_names: dict[uuid.UUID, str] = {}
    if site_ids:
        for s in db.scalars(select(Site).where(Site.id.in_(site_ids))):
            site_names[s.id] = s.name
    out: list[AlertRead] = []
    for a in rows:
        psid: uuid.UUID | None = None
        pname: str | None = None
        if a.device_id and a.device_id in devices_by_id:
            d = devices_by_id[a.device_id]
            psid = d.site_id
            pname = site_names.get(d.site_id)
        elif a.site_id:
            psid = a.site_id
            pname = site_names.get(a.site_id)
        base = AlertRead.model_validate(a)
        out.append(base.model_copy(update={"platform_site_id": psid, "platform_site_name": pname}))
    return out


def alert_to_read(db: Session, a: Alert) -> AlertRead:
    return _enrich_alert_rows(db, [a])[0]


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
    built = _alert_filter_parts(
        db,
        user,
        site_id=site_id,
        severity=severity,
        category=category,
        acknowledged=acknowledged,
        search=search,
    )
    if built is None:
        return AlertListResponse(items=[], total=0)
    parts, _ = built
    base = _alert_base_join()
    stmt = base.where(*parts)
    total = int(
        db.scalar(select(func.count()).select_from(Alert).outerjoin(Device, Device.id == Alert.device_id).where(*parts))
        or 0
    )
    rows = list(db.scalars(stmt.order_by(Alert.created_at.desc()).limit(limit).offset(offset)).all())
    return AlertListResponse(items=_enrich_alert_rows(db, rows), total=total)


def acknowledge_all_unacked(
    db: Session,
    user: User,
    *,
    site_id: uuid.UUID | None = None,
    severity: str | None = None,
    category: str | None = None,
    search: str | None = None,
    limit: int = 500,
) -> int:
    """Acknowledge up to ``limit`` unacknowledged alerts matching the same filters as list (excluding ack filter)."""
    built = _alert_filter_parts(
        db,
        user,
        site_id=site_id,
        severity=severity,
        category=category,
        acknowledged=False,
        search=search,
    )
    if built is None:
        return 0
    parts, _ = built
    id_subq = (
        select(Alert.id)
        .outerjoin(Device, Device.id == Alert.device_id)
        .where(*parts)
        .order_by(Alert.created_at.desc())
        .limit(min(limit, 500))
    )
    ids = [r[0] for r in db.execute(id_subq).all()]
    if not ids:
        return 0
    now = datetime.now(timezone.utc)
    res = db.execute(
        update(Alert)
        .where(Alert.id.in_(ids), Alert.acknowledged.is_(False))
        .values(acknowledged=True, acknowledged_at=now, acknowledged_by_user_id=user.id)
    )
    db.commit()
    reconcile_unacked_redis(db, customer_id=user.customer_id)
    return int(res.rowcount or 0)


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
