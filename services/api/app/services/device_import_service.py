from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.access_control import ensure_site_in_tenant
from app.models.device import Device
from app.models.device_import_audit import DeviceImportAudit
from app.models.device_object import DeviceObject
from app.schemas.device_import import DeviceImportCommitResponse, DeviceImportRowError, DeviceImportRowIn
from app.services.device_version_lineage_service import ensure_bootstrap_lineage_row
from app.services.functional_audit_alert import emit_functional_audit_alert

if TYPE_CHECKING:
    from app.models.user import User

log = logging.getLogger(__name__)


def _single_site_id_from_rows(rows: list[DeviceImportRowIn]) -> uuid.UUID | None:
    ids = {r.site_id for r in rows}
    if len(ids) == 1:
        return next(iter(ids))
    return None


def validate_import_rows(
    db: Session,
    user: "User",
    rows: list[DeviceImportRowIn],
    allowed_site_ids: list[uuid.UUID] | None,
) -> tuple[bool, list[DeviceImportRowError]]:
    """
    Cross-row and DB uniqueness checks. Caller ensures sites are in-tenant.
    Returns (ok, row_errors) where ok is True iff row_errors is empty.
    """
    errors: list[DeviceImportRowError] = []

    if not rows:
        return False, [DeviceImportRowError(line=0, message="No rows to validate.")]

    seen: dict[tuple[uuid.UUID, str], int] = {}
    for r in rows:
        if not ensure_site_in_tenant(db, user.customer_id, r.site_id):
            errors.append(DeviceImportRowError(line=r.line, message="Unknown site for this tenant."))
            continue
        name = r.name.strip()
        if not name:
            errors.append(DeviceImportRowError(line=r.line, message="Device name is empty."))
            continue
        if len(name) > 255:
            errors.append(DeviceImportRowError(line=r.line, message="Device name exceeds 255 characters."))
            continue
        if allowed_site_ids is not None and r.site_id not in allowed_site_ids:
            errors.append(DeviceImportRowError(line=r.line, message="Site is not permitted for this user."))
            continue

        key = (r.site_id, name.lower())
        if key in seen:
            errors.append(
                DeviceImportRowError(
                    line=r.line,
                    message=f"Duplicate device name in import (same site as line {seen[key]}).",
                )
            )
        else:
            seen[key] = r.line

    if errors:
        return False, errors

    for r in rows:
        name = r.name.strip()
        exists = db.execute(
            select(Device.id).where(
                Device.customer_id == user.customer_id,
                Device.site_id == r.site_id,
                func.lower(Device.name) == name.lower(),
            )
        ).scalar_one_or_none()
        if exists is not None:
            errors.append(
                DeviceImportRowError(
                    line=r.line,
                    message="A device with this name already exists at this site.",
                )
            )

    return (len(errors) == 0, errors)


def commit_device_import(
    db: Session,
    user: "User",
    rows: list[DeviceImportRowIn],
    source_label: str | None,
    allowed_site_ids: list[uuid.UUID] | None,
) -> DeviceImportCommitResponse:
    """Validate, create devices with savepoints, write audit row."""
    ok, v_errs = validate_import_rows(db, user, rows, allowed_site_ids)
    if not ok:
        audit = DeviceImportAudit(
            id=uuid.uuid4(),
            customer_id=user.customer_id,
            user_id=user.id,
            status="failed",
            source_label=(source_label.strip()[:255] if source_label and source_label.strip() else None),
            row_count=len(rows),
            success_count=0,
            failure_count=0,
            detail_json={"validation_errors": [e.model_dump() for e in v_errs]},
        )
        db.add(audit)
        db.commit()
        audit = db.get(DeviceImportAudit, audit.id)
        if audit:
            emit_functional_audit_alert(
                db,
                customer_id=user.customer_id,
                actor=user,
                last_updated_by=user,
                verb="failed",
                resource_type="Device import",
                resource_label="Validation failed before import.",
                site_id=_single_site_id_from_rows(rows),
                device_id=None,
                resource_created_at=audit.created_at,
                resource_updated_at=audit.updated_at,
                activity_summary=f"{len(rows)} row(s) rejected. {len(v_errs)} validation issue(s).",
                source_object_type="device_import_audit",
                source_object_id=audit.id,
            )
        return DeviceImportCommitResponse(
            audit_id=audit.id,
            status="failed",
            row_count=len(rows),
            success_count=0,
            failure_count=0,
            failures=v_errs,
        )

    audit = DeviceImportAudit(
        id=uuid.uuid4(),
        customer_id=user.customer_id,
        user_id=user.id,
        status="running",
        source_label=(source_label.strip()[:255] if source_label and source_label.strip() else None),
        row_count=len(rows),
        success_count=0,
        failure_count=0,
        detail_json=None,
    )
    db.add(audit)
    db.flush()
    failures: list[DeviceImportRowError] = []
    success = 0
    created_devices: list[Device] = []
    for r in rows:
        try:
            with db.begin_nested():
                device = Device(
                    id=uuid.uuid4(),
                    customer_id=user.customer_id,
                    site_id=r.site_id,
                    name=r.name.strip(),
                    description=r.description,
                    icon=r.icon,
                    is_active=True if r.is_active is None else r.is_active,
                    polling_enabled=True if r.polling_enabled is None else r.polling_enabled,
                    expected_interval_seconds=r.expected_interval_seconds
                    if r.expected_interval_seconds is not None
                    else 60,
                    late_threshold_seconds=r.late_threshold_seconds
                    if r.late_threshold_seconds is not None
                    else 120,
                    offline_threshold_seconds=r.offline_threshold_seconds
                    if r.offline_threshold_seconds is not None
                    else 300,
                    firmware_version=r.firmware_version,
                    firmware_channel=r.firmware_channel if r.firmware_channel is not None else "stable",
                    ota_supported=False if r.ota_supported is None else r.ota_supported,
                    rollback_supported=False if r.rollback_supported is None else r.rollback_supported,
                    device_version=((r.device_version or "").strip() or "1")[:64],
                    version_status=r.version_status if r.version_status is not None else "active",
                )
                db.add(device)
                db.flush()
                db.add(
                    DeviceObject(
                        id=uuid.uuid4(),
                        device_id=device.id,
                        customer_id=user.customer_id,
                        mapping={},
                    )
                )
            success += 1
            created_devices.append(device)
        except IntegrityError as ex:
            log.warning("device_import row failed line=%s: %s", r.line, ex)
            failures.append(
                DeviceImportRowError(
                    line=r.line,
                    message="Database constraint failed (duplicate name or invalid reference).",
                )
            )
        except Exception as ex:  # noqa: BLE001
            log.exception("device_import row failed line=%s", r.line)
            msg = str(ex).strip() or "Create failed"
            failures.append(DeviceImportRowError(line=r.line, message=msg[:500]))

    audit.success_count = success
    audit.failure_count = len(failures)
    if failures and success > 0:
        audit.status = "partial"
    elif failures:
        audit.status = "failed"
    else:
        audit.status = "succeeded"
    audit.detail_json = {"failures": [f.model_dump() for f in failures]} if failures else None
    db.commit()
    for d in created_devices:
        ensure_bootstrap_lineage_row(db, d, fp=None)
    if created_devices:
        db.commit()
    audit = db.get(DeviceImportAudit, audit.id)
    if audit:
        n = len(rows)
        if audit.status == "succeeded":
            verb = "completed"
            headline = f"{success} device{'s' if success != 1 else ''} imported successfully."
        elif audit.status == "partial":
            verb = "partial"
            headline = f"{success} of {n} devices imported successfully; {len(failures)} failed."
        else:
            verb = "failed"
            headline = (
                f"No devices imported; {len(failures)} row(s) failed."
                if success == 0
                else f"{success} of {n} devices saved; import still marked failed (see audit)."
            )
        src = (source_label or "").strip()
        activity_summary = f"Source: {src[:500]}" if src else None
        emit_functional_audit_alert(
            db,
            customer_id=user.customer_id,
            actor=user,
            last_updated_by=user,
            verb=verb,
            resource_type="Device import",
            resource_label=headline[:500],
            site_id=_single_site_id_from_rows(rows),
            device_id=None,
            resource_created_at=audit.created_at,
            resource_updated_at=audit.updated_at,
            activity_summary=activity_summary,
            source_object_type="device_import_audit",
            source_object_id=audit.id,
        )
    return DeviceImportCommitResponse(
        audit_id=audit.id,
        status=audit.status,
        row_count=len(rows),
        success_count=success,
        failure_count=len(failures),
        failures=failures,
    )
