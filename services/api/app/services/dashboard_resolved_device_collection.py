"""Resolved device collection runtime query + summary buckets for dashboard endpoint groups."""

from __future__ import annotations

import base64
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.endpoint import Endpoint
from app.models.latest_device_state import LatestDeviceState
from app.models.resolved_device import ResolvedDevice

_NIL_UUID = uuid.UUID("00000000-0000-0000-0000-000000000000")

LIFECYCLE_SUMMARY_BUCKETS = ("online", "late", "offline", "error")
HEALTH_SUMMARY_BUCKETS = ("healthy", "warning", "critical", "unknown")


def lifecycle_summary_bucket(value: str | None) -> str:
    s = (value or "").strip().lower()
    if s in {"error", "failed", "fault"}:
        return "error"
    if s in {"offline", "inactive", "disconnected"}:
        return "offline"
    if s in {"late", "stale", "degraded"}:
        return "late"
    return "online"


def health_summary_bucket(value: str | None) -> str:
    s = (value or "").strip().lower()
    if s in {"critical", "red", "severe"}:
        return "critical"
    if s in {"warning", "warn", "yellow"}:
        return "warning"
    if s in {"healthy", "green", "ok", "normal"}:
        return "healthy"
    return "unknown"


@dataclass(frozen=True)
class ResolvedDeviceCollectionCursor:
    updated_at: datetime
    scrubbed_event_id: uuid.UUID | None
    resolved_device_id: uuid.UUID


def encode_cursor(cursor: ResolvedDeviceCollectionCursor) -> str:
    body = {
        "updated_at": cursor.updated_at.astimezone(timezone.utc).isoformat(),
        "scrubbed_event_id": str(cursor.scrubbed_event_id) if cursor.scrubbed_event_id else None,
        "resolved_device_id": str(cursor.resolved_device_id),
    }
    payload = json.dumps(body, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii")


def decode_cursor(raw: str) -> ResolvedDeviceCollectionCursor:
    try:
        payload = base64.urlsafe_b64decode(raw.encode("ascii"))
        obj = json.loads(payload.decode("utf-8"))
        updated = datetime.fromisoformat(str(obj["updated_at"]))
        scrubbed_raw = obj.get("scrubbed_event_id")
        scrubbed = uuid.UUID(str(scrubbed_raw)) if scrubbed_raw else None
        resolved = uuid.UUID(str(obj["resolved_device_id"]))
        return ResolvedDeviceCollectionCursor(
            updated_at=updated.astimezone(timezone.utc),
            scrubbed_event_id=scrubbed,
            resolved_device_id=resolved,
        )
    except Exception as e:  # noqa: BLE001
        raise ValueError("Invalid cursor format") from e


def _coalesced_scrubbed_id_expr():
    return func.coalesce(LatestDeviceState.scrubbed_event_id, _NIL_UUID)


def _location_json_coords_present():
    """PostgreSQL JSONB: non-null lat/lon text values (dashboard map uses top-level lat/lon)."""
    j = LatestDeviceState.location_json
    lat = j["lat"].astext
    lon = j["lon"].astext
    return and_(
        j.isnot(None),
        lat.isnot(None),
        lon.isnot(None),
        func.length(func.trim(lat)) > 0,
        func.length(func.trim(lon)) > 0,
    )


def _ranked_latest_device_state_subquery(
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    object_name: str,
    lifecycle_status: str | None,
    health_status: str | None,
):
    scrubbed_key = _coalesced_scrubbed_id_expr()
    ranked = (
        select(
            LatestDeviceState.id.label("id"),
            func.row_number()
            .over(
                partition_by=LatestDeviceState.resolved_device_id,
                order_by=(
                    LatestDeviceState.updated_at.desc(),
                    scrubbed_key.desc(),
                    LatestDeviceState.resolved_device_id.asc(),
                ),
            )
            .label("rn"),
        )
        .where(
            LatestDeviceState.customer_id == customer_id,
            LatestDeviceState.site_id == site_id,
            LatestDeviceState.endpoint_id == endpoint_id,
            LatestDeviceState.object_name == object_name,
        )
    )
    if lifecycle_status:
        ranked = ranked.where(LatestDeviceState.lifecycle_status == lifecycle_status)
    if health_status:
        ranked = ranked.where(LatestDeviceState.health_status == health_status)
    return ranked.subquery("ranked_latest_device_state")


def count_deduped_missing_location(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    object_name: str,
    lifecycle_status: str | None,
    health_status: str | None,
    device_type: str | None,
) -> int:
    """How many resolved devices (latest row each) lack usable lat/lon in location_json."""
    ranked_sq = _ranked_latest_device_state_subquery(
        customer_id=customer_id,
        site_id=site_id,
        endpoint_id=endpoint_id,
        object_name=object_name,
        lifecycle_status=lifecycle_status,
        health_status=health_status,
    )
    stmt = (
        select(func.count())
        .select_from(LatestDeviceState)
        .join(ranked_sq, ranked_sq.c.id == LatestDeviceState.id)
        .join(ResolvedDevice, ResolvedDevice.id == LatestDeviceState.resolved_device_id, isouter=True)
        .where(ranked_sq.c.rn == 1, ~_location_json_coords_present())
    )
    if device_type:
        stmt = stmt.where(ResolvedDevice.device_type == device_type)
    return int(db.scalar(stmt) or 0)


def list_collection_sources(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    limit: int,
) -> list[dict[str, Any]]:
    stmt = (
        select(
            LatestDeviceState.endpoint_id,
            LatestDeviceState.object_name,
            func.max(LatestDeviceState.updated_at).label("latest_updated_at"),
            func.count(LatestDeviceState.resolved_device_id).label("resolved_device_count"),
        )
        .where(
            LatestDeviceState.customer_id == customer_id,
            LatestDeviceState.site_id == site_id,
        )
        .group_by(LatestDeviceState.endpoint_id, LatestDeviceState.object_name)
        .order_by(func.max(LatestDeviceState.updated_at).desc(), LatestDeviceState.endpoint_id.asc())
        .limit(max(1, min(limit, 500)))
    )
    rows = db.execute(stmt).all()
    if not rows:
        return []
    endpoint_names = {
        r.id: r.endpoint_name
        for r in db.scalars(
            select(Endpoint).where(
                Endpoint.customer_id == customer_id,
                Endpoint.site_id == site_id,
                Endpoint.id.in_([row.endpoint_id for row in rows]),
            )
        ).all()
    }
    return [
        {
            "site_id": site_id,
            "endpoint_id": row.endpoint_id,
            "endpoint_name": endpoint_names.get(row.endpoint_id),
            "object_name": row.object_name,
            "latest_updated_at": row.latest_updated_at,
            "resolved_device_count": int(row.resolved_device_count or 0),
        }
        for row in rows
    ]


def query_collection_page(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    object_name: str,
    lifecycle_status: str | None,
    health_status: str | None,
    device_type: str | None,
    limit: int,
    cursor: ResolvedDeviceCollectionCursor | None,
    require_location: bool = False,
    include_excluded_missing_location_count: bool = True,
) -> tuple[list[tuple[LatestDeviceState, ResolvedDevice | None]], str | None, dict[str, Any]]:
    scrubbed_key = _coalesced_scrubbed_id_expr()
    ranked_sq = _ranked_latest_device_state_subquery(
        customer_id=customer_id,
        site_id=site_id,
        endpoint_id=endpoint_id,
        object_name=object_name,
        lifecycle_status=lifecycle_status,
        health_status=health_status,
    )

    stmt = (
        select(LatestDeviceState, ResolvedDevice)
        .join(ranked_sq, ranked_sq.c.id == LatestDeviceState.id)
        .join(ResolvedDevice, ResolvedDevice.id == LatestDeviceState.resolved_device_id, isouter=True)
        .where(ranked_sq.c.rn == 1)
    )
    if device_type:
        stmt = stmt.where(ResolvedDevice.device_type == device_type)
    if require_location:
        stmt = stmt.where(_location_json_coords_present())

    if cursor is not None:
        cursor_scrubbed = cursor.scrubbed_event_id or _NIL_UUID
        stmt = stmt.where(
            or_(
                LatestDeviceState.updated_at < cursor.updated_at,
                and_(
                    LatestDeviceState.updated_at == cursor.updated_at,
                    scrubbed_key < cursor_scrubbed,
                ),
                and_(
                    LatestDeviceState.updated_at == cursor.updated_at,
                    scrubbed_key == cursor_scrubbed,
                    LatestDeviceState.resolved_device_id > cursor.resolved_device_id,
                ),
            )
        )

    stmt = stmt.order_by(
        LatestDeviceState.updated_at.desc(),
        scrubbed_key.desc(),
        LatestDeviceState.resolved_device_id.asc(),
    ).limit(max(1, min(limit, 500)) + 1)

    rows = db.execute(stmt).all()
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor: str | None = None
    if has_more and page:
        last_state = page[-1][0]
        next_cursor = encode_cursor(
            ResolvedDeviceCollectionCursor(
                updated_at=last_state.updated_at,
                scrubbed_event_id=last_state.scrubbed_event_id,
                resolved_device_id=last_state.resolved_device_id,
            )
        )

    excluded_missing_location = (
        count_deduped_missing_location(
            db,
            customer_id=customer_id,
            site_id=site_id,
            endpoint_id=endpoint_id,
            object_name=object_name,
            lifecycle_status=lifecycle_status,
            health_status=health_status,
            device_type=device_type,
        )
        if require_location and include_excluded_missing_location_count
        else 0
    )

    summary = {
        "total": 0,
        "online": 0,
        "late": 0,
        "offline": 0,
        "error": 0,
        "healthy": 0,
        "warning": 0,
        "critical": 0,
        "unknown": 0,
        "avg_health_score": None,
        "excluded_missing_location": excluded_missing_location,
    }
    scores: list[float] = []
    for state, _rd in page:
        summary["total"] += 1
        summary[lifecycle_summary_bucket(state.lifecycle_status)] += 1
        summary[health_summary_bucket(state.health_status)] += 1
        if isinstance(state.health_json, dict):
            raw_score = state.health_json.get("health_score")
            if isinstance(raw_score, (int, float)):
                scores.append(float(raw_score))
    if scores:
        summary["avg_health_score"] = round(sum(scores) / len(scores), 4)

    return page, next_cursor, summary
