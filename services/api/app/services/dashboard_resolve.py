"""Resolve primary vs synthetic default dashboard (shared by enterprise + dashboards landing)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, user_may_access_site
from app.core.dashboard_status import DASHBOARD_FROZEN
from app.models.dashboard import Dashboard
from app.models.dashboard_user_preference import DashboardUserPreference
from app.models.site import Site
from app.models.user import User
from app.schemas.dashboard import DashboardLiveResponse
from app.schemas.dashboard_layout import iter_widgets
from app.services.dashboard_default_template import default_ops_template_layout
from app.services.dashboard_live import build_live_payload
from app.services.dashboard_validation import (
    validate_layout_for_save,
    validate_site_coherence,
    validate_sources_exist,
    validate_widgets_for_freeze,
)

log = logging.getLogger(__name__)

SYNTHETIC_DASHBOARD_ID = "__operations_overview__"


def _widget_count(layout: dict[str, Any]) -> int:
    return len(iter_widgets(layout))


def _primary_dashboard_errors(db: Session, user: User, d: Dashboard) -> list[str]:
    """Non-empty list means primary is not valid for live resolution."""
    errs: list[str] = []
    if d.status != DASHBOARD_FROZEN:
        errs.append("primary_not_frozen")
    layout = dict(d.layout or {})
    if _widget_count(layout) < 1:
        errs.append("primary_no_widgets")
    allowed = allowed_site_ids_for_user(db, user)
    if d.site_id and not user_may_access_site(user, d.site_id, allowed):
        errs.append("primary_site_forbidden")
    errs.extend(validate_layout_for_save(layout=layout, site_id=d.site_id, require_widgets=False))
    errs.extend(validate_sources_exist(db, customer_id=user.customer_id, layout=layout))
    errs.extend(
        validate_site_coherence(
            dashboard_site_id=d.site_id, layout=layout, db=db, customer_id=user.customer_id
        )
    )
    errs.extend(validate_widgets_for_freeze(layout=layout))
    if errs:
        return errs
    try:
        meta = {
            "id": str(d.id),
            "name": d.name,
            "description": d.description,
            "status": d.status,
            "site_id": str(d.site_id) if d.site_id else None,
            "layout": layout,
        }
        bundle = build_live_payload(
            db,
            customer_id=user.customer_id,
            layout=layout,
            dashboard_meta=meta,
            dashboard_site_id=d.site_id,
            allowed_site_ids=allowed,
        )
    except Exception:
        log.warning("primary dashboard build_live_payload failed", exc_info=True)
        errs.append("primary_build_failed")
        return errs
    for w in bundle.get("widgets") or []:
        data = w.get("data") if isinstance(w.get("data"), dict) else {}
        if data.get("error") and w.get("type") not in (
            "text",
            "ops_recent_activity",
            "ops_recent_alerts",
            "ops_alert_trends",
        ):
            errs.append(f"primary_widget_error:{w.get('widget_id')}")
            break
    return errs


def pick_default_site_id(db: Session, user: User) -> uuid.UUID | None:
    """First accessible site for the tenant (for map + site aggregates)."""
    allowed = allowed_site_ids_for_user(db, user)
    stmt = select(Site.id).where(Site.customer_id == user.customer_id).order_by(Site.name.asc())
    if allowed is not None:
        if len(allowed) == 0:
            return None
        stmt = stmt.where(Site.id.in_(allowed))
    return db.scalar(stmt.limit(1))


def resolve_dashboard_live_bundle(
    db: Session,
    user: User,
    *,
    scope_site_id: uuid.UUID | None = None,
    scope_hours: int | None = None,
) -> tuple[dict[str, Any], uuid.UUID | None, bool, datetime | None]:
    """Returns (bundle, primary_id or None, is_default, resolved_since for synthetic scope)."""
    pref = db.get(DashboardUserPreference, user.id)
    primary_id = pref.primary_dashboard_id if pref else None
    d: Dashboard | None = None
    if primary_id:
        d = db.get(Dashboard, primary_id)
        if not d or d.customer_id != user.customer_id:
            d = None
            if pref:
                pref.primary_dashboard_id = None
                db.add(pref)
                db.commit()

    if d is not None and not _primary_dashboard_errors(db, user, d):
        meta = {
            "id": str(d.id),
            "name": d.name,
            "description": d.description,
            "status": d.status,
            "site_id": str(d.site_id) if d.site_id else None,
            "layout": dict(d.layout or {}),
        }
        allowed = allowed_site_ids_for_user(db, user)
        bundle = build_live_payload(
            db,
            customer_id=user.customer_id,
            layout=dict(d.layout or {}),
            dashboard_meta=meta,
            dashboard_site_id=d.site_id,
            allowed_site_ids=allowed,
        )
        return bundle, d.id, False, None

    allowed = allowed_site_ids_for_user(db, user)
    since: datetime | None = None
    if scope_hours is not None and scope_hours > 0:
        since = datetime.now(timezone.utc) - timedelta(hours=int(scope_hours))

    site_id = pick_default_site_id(db, user)
    eff_allowed = allowed
    if scope_site_id is not None and user_may_access_site(user, scope_site_id, allowed):
        site_id = scope_site_id
        eff_allowed = [scope_site_id]

    if site_id is None:
        layout = {"version": 1, "rows": [], "settings": {"refreshIntervalSec": 30}}
        bundle = build_live_payload(
            db,
            customer_id=user.customer_id,
            layout=layout,
            dashboard_meta={
                "id": SYNTHETIC_DASHBOARD_ID,
                "name": "Operations Overview",
                "description": None,
                "status": "synthetic",
                "site_id": None,
                "layout": layout,
                "is_default_dashboard": True,
            },
            dashboard_site_id=None,
            allowed_site_ids=eff_allowed,
            resolved_since=since,
        )
        return bundle, None, True, since

    layout = default_ops_template_layout(site_id=site_id)
    meta = {
        "id": SYNTHETIC_DASHBOARD_ID,
        "name": "Operations Overview",
        "description": "System default dashboard",
        "status": "synthetic",
        "site_id": str(site_id),
        "layout": layout,
        "is_default_dashboard": True,
    }
    bundle = build_live_payload(
        db,
        customer_id=user.customer_id,
        layout=layout,
        dashboard_meta=meta,
        dashboard_site_id=site_id,
        allowed_site_ids=eff_allowed,
        resolved_since=since,
    )
    return bundle, None, True, since


def build_dashboard_live_response(
    db: Session,
    user: User,
    *,
    scope_site_id: uuid.UUID | None = None,
    scope_hours: int | None = None,
) -> DashboardLiveResponse:
    bundle, primary_id, is_default, resolved_since = resolve_dashboard_live_bundle(
        db, user, scope_site_id=scope_site_id, scope_hours=scope_hours
    )
    command_center: dict[str, Any] | None = None
    if is_default:
        from app.services.dashboard_ops_command_center import build_ops_command_center

        allowed = allowed_site_ids_for_user(db, user)
        command_center = build_ops_command_center(
            db,
            customer_id=user.customer_id,
            allowed_site_ids=allowed,
            since=resolved_since,
            widgets=list(bundle.get("widgets") or []),
        )
    return DashboardLiveResponse(
        dashboard=bundle["dashboard"],
        widgets=bundle["widgets"],
        rendered_at=bundle["rendered_at"],
        primary_dashboard_id=primary_id,
        is_default_dashboard=is_default,
        command_center=command_center,
    )


