"""Domain-specific deactivate / reactivate / archive (orthogonal operational retirement)."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.core.dashboard_status import DASHBOARD_ARCHIVED, DASHBOARD_DRAFT, DASHBOARD_INACTIVE
from app.core.data_object_lifecycle import DATA_ARCHIVED, DATA_COMPILED, DATA_INACTIVE
from app.core.operational_status import OPERATIONAL_ACTIVE, OPERATIONAL_ARCHIVED, OPERATIONAL_INACTIVE as OP_INACTIVE
from app.core.workflow_lifecycle import WF_ARCHIVED, WF_INACTIVE, WF_VALIDATED
from app.models.dashboard import Dashboard
from app.models.data_object import DataObject
from app.models.device import Device
from app.models.published_service import PublishedService
from app.models.site import Site
from app.models.workflow import Workflow
from app.models.workflow_result_object import WorkflowResultObject


def deactivate_data_object(db: Session, row: DataObject) -> None:
    row.lifecycle_status = DATA_INACTIVE
    db.add(row)


def reactivate_data_object(db: Session, row: DataObject) -> None:
    row.lifecycle_status = DATA_COMPILED
    db.add(row)


def archive_data_object(db: Session, row: DataObject) -> None:
    row.lifecycle_status = DATA_ARCHIVED
    db.add(row)


def deactivate_workflow(db: Session, wf: Workflow) -> None:
    wf.is_published = False
    wf.lifecycle_status = WF_INACTIVE
    db.add(wf)


def reactivate_workflow(db: Session, wf: Workflow) -> None:
    wf.lifecycle_status = WF_VALIDATED
    db.add(wf)


def archive_workflow(db: Session, wf: Workflow) -> None:
    wf.is_published = False
    wf.lifecycle_status = WF_ARCHIVED
    db.add(wf)


def deactivate_dashboard(db: Session, d: Dashboard) -> None:
    d.status = DASHBOARD_INACTIVE
    db.add(d)


def reactivate_dashboard(db: Session, d: Dashboard) -> None:
    d.status = DASHBOARD_DRAFT
    db.add(d)


def archive_dashboard(db: Session, d: Dashboard) -> None:
    d.status = DASHBOARD_ARCHIVED
    db.add(d)


def deactivate_site(db: Session, site: Site) -> None:
    site.operational_status = OP_INACTIVE
    db.add(site)


def reactivate_site(db: Session, site: Site) -> None:
    site.operational_status = OPERATIONAL_ACTIVE
    db.add(site)


def archive_site(db: Session, site: Site) -> None:
    site.operational_status = OPERATIONAL_ARCHIVED
    db.add(site)


def deactivate_device(db: Session, device: Device) -> None:
    device.operational_status = OP_INACTIVE
    device.is_active = False
    device.polling_enabled = False
    db.add(device)


def reactivate_device(db: Session, device: Device) -> None:
    device.operational_status = OPERATIONAL_ACTIVE
    device.is_active = True
    db.add(device)


def archive_device(db: Session, device: Device) -> None:
    device.operational_status = OPERATIONAL_ARCHIVED
    device.is_active = False
    device.polling_enabled = False
    db.add(device)


def deactivate_published_service(db: Session, row: PublishedService) -> None:
    row.status = "inactive"
    db.add(row)


def reactivate_published_service(db: Session, row: PublishedService) -> None:
    row.status = "draft"
    db.add(row)


def archive_published_service(db: Session, row: PublishedService) -> None:
    row.status = "archived"
    db.add(row)


def deactivate_result_object(db: Session, row: WorkflowResultObject) -> None:
    row.operational_status = OP_INACTIVE
    db.add(row)


def reactivate_result_object(db: Session, row: WorkflowResultObject) -> None:
    row.operational_status = OPERATIONAL_ACTIVE
    db.add(row)


def archive_result_object(db: Session, row: WorkflowResultObject) -> None:
    row.operational_status = OPERATIONAL_ARCHIVED
    db.add(row)


def clear_primary_dashboard_for_all_users(db: Session, *, dashboard_id: uuid.UUID) -> None:
    from sqlalchemy import update

    from app.models.dashboard_user_preference import DashboardUserPreference

    db.execute(
        update(DashboardUserPreference)
        .where(DashboardUserPreference.primary_dashboard_id == dashboard_id)
        .values(primary_dashboard_id=None)
    )
