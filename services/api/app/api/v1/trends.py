"""Trend windows API (contract: GET /trends/window)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, ensure_site_in_tenant, user_may_access_site
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.trends import TrendsWindowResponse
from app.services.trends_window_service import build_trends_window_response

router = APIRouter()


@router.get(
    "/window",
    response_model=TrendsWindowResponse,
    response_model_by_alias=True,
)
def get_trends_window(
    site_id: uuid.UUID = Query(..., description="Site context for auth and endpoint/site scoping"),
    scope: str = Query(..., pattern="^(resolved_device|endpoint|site)$"),
    entity_id: uuid.UUID = Query(..., alias="entityId", description="Entity UUID for the given scope"),
    metrics: str = Query(..., description="Comma-separated metric keys"),
    window: str = Query("1h", pattern="^(1h|24h)$"),
    bucket: str = Query("5m", pattern="^5m$"),
    as_of: str | None = Query(None, description="Optional ISO timestamp (frozen/debug)"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Authorized trend read: same site gate as map runtime; entity must belong to site_id."""
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    parts = [p.strip() for p in metrics.split(",") if p.strip()]
    if not parts:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "metrics must list at least one key")

    try:
        body = build_trends_window_response(
            db,
            customer_id=user.customer_id,
            site_id=site_id,
            scope=scope,
            entity_id=entity_id,
            metrics=parts,
            window=window,
            bucket=bucket,
            as_of_raw=as_of,
        )
    except PermissionError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from e
    except LookupError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entity not found") from None
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    return body
