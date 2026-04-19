"""Delete operational data for a tenant while keeping sites (and users, customer row)."""

from __future__ import annotations

import uuid

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.dashboard import Dashboard
from app.models.dashboard_user_preference import DashboardUserPreference
from app.models.data_object import DataObject
from app.models.device import Device
from app.models.health_threshold_reference import HealthThresholdReference
from app.models.published_service import PublishedService
from app.models.raw_data_object import RawDataObject
from app.models.static_ingestion import StaticIngestion
from app.models.workflow import Workflow


def _count(db: Session, model: type, *where) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


def clear_operational_data_except_sites(db: Session, customer_id: uuid.UUID) -> dict[str, int]:
    """Remove devices, raw/data objects, workflows (incl. result objects), dashboards, and related rows.

    Preserves: ``sites``, ``users``, ``customers``, platform config (ports, LLM, monitoring).
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

    n = _count(db, DataObject, DataObject.customer_id == customer_id)
    db.execute(delete(DataObject).where(DataObject.customer_id == customer_id))
    stats["data_objects"] = n

    n = _count(db, RawDataObject, RawDataObject.customer_id == customer_id)
    db.execute(delete(RawDataObject).where(RawDataObject.customer_id == customer_id))
    stats["raw_data_objects"] = n

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

    return stats
