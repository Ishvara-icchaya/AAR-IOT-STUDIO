"""Delete operational data for a tenant while keeping sites (and users, customer row)."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.dashboard import Dashboard
from app.models.dashboard_user_preference import DashboardUserPreference
from app.models.data_object import DataObject
from app.models.data_object_detail import DataObjectDetail
from app.models.device import Device
from app.models.endpoint import Endpoint
from app.models.health_threshold_reference import HealthThresholdReference
from app.models.latest_device_state import LatestDeviceState
from app.models.published_service import PublishedService
from app.models.raw_data_object import RawDataObject
from app.models.resolved_device import ResolvedDevice
from app.models.scrubbed_event import ScrubbedEvent
from app.models.static_ingestion import StaticIngestion
from app.models.workflow import Workflow

# Bounds WAL growth and lock duration vs one multi-hour DELETE transaction on huge tables.
_DELETE_BATCH_SIZE = 5000
# Detail rows are usually far more numerous than data_objects; slightly larger batches cut round-trips.
_DETAIL_DELETE_BATCH_SIZE = 10_000

ProgressFn = Callable[[dict[str, Any]], None]


def _count(db: Session, model: type, *where) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


def _emit(progress: ProgressFn | None, phase: str, stats: dict[str, int]) -> None:
    if progress:
        progress({"phase": phase, "deleted_counts": dict(stats)})


def _delete_where_customer_id_batched(
    db: Session,
    model: type,
    customer_id: uuid.UUID,
    *,
    batch_size: int = _DELETE_BATCH_SIZE,
    stats: dict[str, int] | None = None,
    stat_key: str | None = None,
    phase: str = "",
    progress: ProgressFn | None = None,
    emit_every_batches: int = 4,
) -> int:
    """DELETE … WHERE customer_id = … in chunks; commit after each chunk.

    Uses Core ``delete(table)`` to avoid ORM ``RETURNING`` overhead on large batches.
    """
    tbl = model.__table__
    id_col = tbl.c.id
    cust_col = tbl.c.customer_id
    total = 0
    batches = 0
    while True:
        subq = select(id_col).where(cust_col == customer_id).limit(batch_size)
        result = db.execute(delete(tbl).where(id_col.in_(subq)))
        deleted = result.rowcount or 0
        if deleted == 0:
            break
        total += deleted
        batches += 1
        if stat_key is not None and stats is not None:
            stats[stat_key] = total
        if progress and stats is not None and phase and batches % emit_every_batches == 0:
            progress({"phase": phase, "deleted_counts": dict(stats)})
        db.commit()
    if stat_key is not None and stats is not None:
        stats[stat_key] = total
    if progress and stats is not None and phase:
        progress({"phase": phase, "deleted_counts": dict(stats)})
    return total


def _null_data_object_latest_detail_batched(
    db: Session,
    customer_id: uuid.UUID,
    *,
    batch_size: int = _DELETE_BATCH_SIZE,
    stats: dict[str, int] | None = None,
    progress: ProgressFn | None = None,
    emit_every_batches: int = 4,
) -> int:
    """Clear latest_detail_id so data_object_details rows can be deleted without FK violations."""
    tbl = DataObject.__table__
    id_col = tbl.c.id
    cust_col = tbl.c.customer_id
    latest = tbl.c.latest_detail_id
    total = 0
    batches = 0
    while True:
        subq = (
            select(id_col)
            .where(cust_col == customer_id, latest.is_not(None))
            .limit(batch_size)
        )
        result = db.execute(update(tbl).where(id_col.in_(subq)).values(latest_detail_id=None))
        n = result.rowcount or 0
        if n == 0:
            break
        total += n
        batches += 1
        if stats is not None:
            stats["data_objects_latest_detail_cleared"] = total
        if progress and stats is not None and batches % emit_every_batches == 0:
            progress({"phase": "latest_detail_null", "deleted_counts": dict(stats)})
        db.commit()
    if stats is not None:
        stats["data_objects_latest_detail_cleared"] = total
    if progress and stats is not None:
        progress({"phase": "latest_detail_null", "deleted_counts": dict(stats)})
    return total


def clear_operational_data_except_sites(
    db: Session,
    customer_id: uuid.UUID,
    *,
    progress: ProgressFn | None = None,
) -> dict[str, int]:
    """Remove devices, raw/data objects, workflows (incl. result objects), dashboards, and related rows.

    Preserves: ``sites``, ``users``, ``customers``, platform config (ports, LLM, monitoring).

    Optional ``progress`` is invoked with ``{"phase": str, "deleted_counts": dict}`` at phase boundaries
    and periodically during large batched deletes (for async job UX).
    """
    stats: dict[str, int] = {}

    dash_ids = select(Dashboard.id).where(Dashboard.customer_id == customer_id)
    prefs = db.execute(
        update(DashboardUserPreference)
        .where(DashboardUserPreference.primary_dashboard_id.in_(dash_ids))
        .values(primary_dashboard_id=None)
    )
    stats["dashboard_primary_preferences_cleared"] = prefs.rowcount or 0

    n = _count(db, Dashboard, Dashboard.customer_id == customer_id)
    db.execute(delete(Dashboard).where(Dashboard.customer_id == customer_id))
    stats["dashboards"] = n

    n = _count(db, PublishedService, PublishedService.customer_id == customer_id)
    db.execute(delete(PublishedService).where(PublishedService.customer_id == customer_id))
    stats["published_services"] = n

    n = _count(db, Workflow, Workflow.customer_id == customer_id)
    db.execute(delete(Workflow).where(Workflow.customer_id == customer_id))
    stats["workflows"] = n

    db.commit()
    _emit(progress, "workflows_done", stats)

    _null_data_object_latest_detail_batched(
        db,
        customer_id,
        stats=stats,
        progress=progress,
    )
    _delete_where_customer_id_batched(
        db,
        DataObjectDetail,
        customer_id,
        batch_size=_DETAIL_DELETE_BATCH_SIZE,
        stats=stats,
        stat_key="data_object_details",
        phase="data_object_details",
        progress=progress,
    )
    _delete_where_customer_id_batched(
        db,
        DataObject,
        customer_id,
        stats=stats,
        stat_key="data_objects",
        phase="data_objects",
        progress=progress,
    )
    _delete_where_customer_id_batched(
        db,
        RawDataObject,
        customer_id,
        stats=stats,
        stat_key="raw_data_objects",
        phase="raw_data_objects",
        progress=progress,
    )

    _delete_where_customer_id_batched(
        db,
        LatestDeviceState,
        customer_id,
        stats=stats,
        stat_key="latest_device_state",
        phase="latest_device_state",
        progress=progress,
    )
    _delete_where_customer_id_batched(
        db,
        ScrubbedEvent,
        customer_id,
        stats=stats,
        stat_key="scrubbed_events",
        phase="scrubbed_events",
        progress=progress,
    )
    _delete_where_customer_id_batched(
        db,
        ResolvedDevice,
        customer_id,
        stats=stats,
        stat_key="resolved_devices",
        phase="resolved_devices",
        progress=progress,
    )

    n = _count(db, Endpoint, Endpoint.customer_id == customer_id)
    db.execute(delete(Endpoint).where(Endpoint.customer_id == customer_id))
    stats["endpoints"] = n
    _emit(progress, "endpoints_done", stats)

    n = _count(db, Alert, Alert.customer_id == customer_id)
    db.execute(delete(Alert).where(Alert.customer_id == customer_id))
    stats["alerts"] = n

    n = _count(db, StaticIngestion, StaticIngestion.customer_id == customer_id)
    db.execute(delete(StaticIngestion).where(StaticIngestion.customer_id == customer_id))
    stats["static_ingestions"] = n

    n = _count(db, HealthThresholdReference, HealthThresholdReference.customer_id == customer_id)
    db.execute(delete(HealthThresholdReference).where(HealthThresholdReference.customer_id == customer_id))
    stats["health_threshold_references"] = n

    n = _count(db, Device, Device.customer_id == customer_id)
    db.execute(delete(Device).where(Device.customer_id == customer_id))
    stats["devices"] = n

    db.commit()
    _emit(progress, "done", stats)

    return stats
