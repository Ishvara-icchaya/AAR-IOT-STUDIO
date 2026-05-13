"""Functional (informational) audit rows in ``alerts`` — human-readable context, no UUIDs in message text."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.alert_severity import INFORMATIONAL_SEVERITY
from app.models.device import Device
from app.models.site import Site
from app.models.user import User
from app.services.alert_emit import emit_alert

log = logging.getLogger(__name__)


def _actor_label(user: User) -> str:
    name = (user.full_name or "").strip()
    if name:
        return f"{name} <{user.email}>"
    return user.email


def _fmt_utc(dt: datetime | None) -> str:
    if dt is None:
        return "—"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _site_name(db: Session, site_id: uuid.UUID | None) -> str:
    if not site_id:
        return "—"
    s = db.get(Site, site_id)
    return (s.name.strip() if s and s.name else "—") or "—"


def _device_name(db: Session, device_id: uuid.UUID | None) -> str:
    if not device_id:
        return "—"
    d = db.get(Device, device_id)
    return (d.name.strip() if d and d.name else "—") or "—"


def emit_functional_audit_alert(
    db: Session,
    *,
    customer_id: uuid.UUID,
    actor: User,
    verb: str,
    resource_type: str,
    resource_label: str,
    site_id: uuid.UUID | None = None,
    device_id: uuid.UUID | None = None,
    resource_created_at: datetime | None = None,
    resource_updated_at: datetime | None = None,
    last_updated_by: User | None = None,
    activity_summary: str | None = None,
    source_component: str = "api.functional_audit",
    source_object_type: str | None = None,
    source_object_id: uuid.UUID | None = None,
) -> None:
    """Persist an informational alert with a fixed multi-line message (no internal IDs in body).

    ``actor`` is the user tied to this HTTP request. ``last_updated_by`` is the user last acting on
    the underlying activity (defaults to ``actor`` when omitted — same person for synchronous writes).
    """
    try:
        now = datetime.now(timezone.utc)
        site_label = _site_name(db, site_id)
        device_label = _device_name(db, device_id)
        activity_editor = last_updated_by if last_updated_by is not None else actor
        verb_l = (verb or "updated").strip().lower()
        title = f"{resource_type} {verb_l}: {(resource_label or resource_type).strip()[:200]}"
        lines = [
            f"Event time (UTC): {_fmt_utc(now)}",
            f"Performed by: {_actor_label(actor)}",
            f"Site: {site_label}",
            f"Device: {device_label}",
            f"Resource: {resource_type} — {(resource_label or '—').strip()[:500]}",
            f"Action: {verb_l}",
            f"Record created (UTC): {_fmt_utc(resource_created_at)}",
            f"Record last updated (UTC): {_fmt_utc(resource_updated_at)}",
            f"Last updated by (this activity): {_actor_label(activity_editor)}",
        ]
        if activity_summary and activity_summary.strip():
            lines.append(f"Activity summary: {activity_summary.strip()[:8000]}")
        message = "\n".join(lines)[:20000]
        emit_alert(
            db=db,
            category="audit",
            severity=INFORMATIONAL_SEVERITY,
            title=title[:255],
            message=message,
            customer_id=customer_id,
            site_id=site_id,
            device_id=device_id,
            source_component=source_component[:100],
            source_object_type=(source_object_type[:64] if source_object_type else None),
            source_object_id=source_object_id,
            trace_id=None,
        )
    except Exception:
        log.debug("functional audit emit failed", exc_info=True)
