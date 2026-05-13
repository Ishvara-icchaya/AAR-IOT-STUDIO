import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, exists
from sqlalchemy.orm import Session, joinedload

from app.access_control import allowed_site_ids_for_user, ensure_site_in_tenant, user_may_access_site
from app.api.deps import get_current_user
from app.core.endpoint_activation import ACTIVATION_STATUS_DESCRIPTION, is_valid_activation_status
from app.core.pipeline_log import emit as pipeline_emit
from app.db.session import get_db
from app.models.device import Device
from app.models.device_endpoint import DeviceEndpoint
from app.models.device_object import DeviceObject
from app.models.device_version import DeviceVersion
from app.models.user import User
from app.schemas.device import (
    DeviceCreate,
    DeviceDeleteResponse,
    DeviceListResponse,
    DeviceOtaTargetHistoryResponse,
    DeviceRead,
    DeviceUpdate,
    DeviceVersionImpactNote,
    DeviceVersionImpactResponse,
    DeviceVersionSnapshotListResponse,
    DeviceVersionSnapshotRead,
    ImpactDashboardRef,
    ImpactWidgetAttributeRow,
    ImpactWorkflowRef,
    OtaTargetHistoryItem,
    VersionFieldDiffEntry,
    VersionLineageResponse,
)
from app.schemas.device_import import (
    DeviceImportCommitRequest,
    DeviceImportCommitResponse,
    DeviceImportValidateRequest,
    DeviceImportValidateResponse,
)
from app.schemas.integrity import DependenciesListResponse, raise_conflict_if_in_use
from app.services.alert_emit import emit_alert
from app.services.control_plane_audit_service import emit_control_plane_audit
from app.services.dependency_service import device_delete_dependencies
from app.services.device_operational_footprint_service import (
    batch_dashboard_association_counts,
    batch_dashboard_references,
    batch_load_footprint_sidecars,
    build_device_footprint_payload,
    evaluate_footprint_for_device,
)
from app.services.device_version_impact_service import (
    build_static_impact_payload,
    list_device_version_snapshots,
    list_ota_target_history_for_device,
)
from app.services.device_version_lineage_service import (
    build_version_lineage_response,
    bump_device_version_monotonic_label,
    ensure_bootstrap_lineage_row,
    kpi_snapshot_from_footprint_dict,
    record_version_lineage_transition,
)
from app.services.device_import_service import commit_device_import as execute_device_import_commit
from app.services.device_import_service import validate_import_rows
from app.services.lifecycle_actions import archive_device, deactivate_device, reactivate_device
from app.services.functional_audit_alert import emit_functional_audit_alert
from app.services.permission_service import ensure_site_permission, ensure_site_permission_any, site_ids_with_permission

router = APIRouter()
log = logging.getLogger(__name__)


def _load_device(db: Session, device_id: uuid.UUID, customer_id: uuid.UUID) -> Device | None:
    return db.execute(
        select(Device)
        .options(joinedload(Device.endpoint))
        .where(Device.id == device_id, Device.customer_id == customer_id)
    ).scalar_one_or_none()


def _device_reads_with_footprint(db: Session, user: User, devices: list[Device]) -> list[DeviceRead]:
    if not devices:
        return []
    ep_by_de, dobjs = batch_load_footprint_sidecars(db, devices)
    dash_counts = batch_dashboard_association_counts(
        db, customer_id=user.customer_id, device_ids={d.id for d in devices}
    )
    out: list[DeviceRead] = []
    for d in devices:
        dr = DeviceRead.model_validate(d)
        st, code, msg = evaluate_footprint_for_device(
            db, d, ep_by_de=ep_by_de, dobjs=dobjs, dashboard_counts=dash_counts
        )
        out.append(
            dr.model_copy(
                update={
                    "footprint_operational_status": st,
                    "footprint_recommendation_code": code,
                    "footprint_recommendation_message": msg,
                }
            )
        )
    return out


def _ensure_device_visible(
    device: Device,
    user: User,
    allowed: list[uuid.UUID] | None,
) -> None:
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted for this user")


@router.get("", response_model=DeviceListResponse)
def list_devices(
    q: str | None = Query(None, description="Search by device name or description (substring, case-insensitive)"),
    site_id: uuid.UUID | None = Query(None),
    endpoint_activation_status: str | None = Query(
        None,
        description=f"Filter by saved endpoint activation_status. {ACTIVATION_STATUS_DESCRIPTION}.",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("devices.list_devices")
    allowed = allowed_site_ids_for_user(db, user)
    if allowed is not None and len(allowed) == 0:
        return DeviceListResponse(items=[])

    stmt = (
        select(Device)
        .options(joinedload(Device.endpoint))
        .where(Device.customer_id == user.customer_id)
        .order_by(Device.name)
    )
    if allowed is not None:
        stmt = stmt.where(Device.site_id.in_(allowed))
    if site_id is not None:
        if allowed is not None and site_id not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
        stmt = stmt.where(Device.site_id == site_id)
    if q and (qs := q.strip()):
        qq = f"%{qs}%"
        stmt = stmt.where(or_(Device.name.ilike(qq), Device.description.ilike(qq)))
    if endpoint_activation_status and (eas := endpoint_activation_status.strip()):
        if not is_valid_activation_status(eas):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Invalid endpoint_activation_status. {ACTIVATION_STATUS_DESCRIPTION}.",
            )
        stmt = stmt.where(
            exists(
                select(DeviceEndpoint.id).where(
                    DeviceEndpoint.device_id == Device.id,
                    DeviceEndpoint.activation_status == eas,
                )
            )
        )

    rows = db.scalars(stmt).unique().all()
    return DeviceListResponse(items=_device_reads_with_footprint(db, user, list(rows)))


@router.post("", response_model=DeviceRead, status_code=status.HTTP_201_CREATED)
def register_device(
    body: DeviceCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("devices.register_device name=%r site_id=%s", body.name, body.site_id)
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
    if not site:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown site")
    if not user_may_access_site(user, body.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot assign device to this site")
    ensure_site_permission(db, user, body.site_id, "devices.write")

    device = Device(
        id=uuid.uuid4(),
        customer_id=user.customer_id,
        site_id=body.site_id,
        name=body.name.strip(),
        description=body.description,
        icon=body.icon,
        is_active=True,
        polling_enabled=True,
        expected_interval_seconds=body.expected_interval_seconds
        if body.expected_interval_seconds is not None
        else 60,
        late_threshold_seconds=body.late_threshold_seconds if body.late_threshold_seconds is not None else 120,
        offline_threshold_seconds=body.offline_threshold_seconds
        if body.offline_threshold_seconds is not None
        else 300,
        firmware_version=body.firmware_version,
        firmware_channel=body.firmware_channel if body.firmware_channel is not None else "stable",
        ota_supported=False if body.ota_supported is None else body.ota_supported,
        rollback_supported=False if body.rollback_supported is None else body.rollback_supported,
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
    db.commit()
    d = _load_device(db, device.id, user.customer_id)
    assert d
    pipeline_emit(
        log,
        component="api.devices",
        action="register_device",
        status="ok",
        device_id=str(device.id),
        site_id=str(body.site_id),
        customer_id=str(user.customer_id),
    )
    ensure_bootstrap_lineage_row(db, d, fp=None)
    db.commit()
    db.refresh(d)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="created",
        resource_type="Device",
        resource_label=d.name,
        site_id=d.site_id,
        device_id=d.id,
        resource_created_at=d.created_at,
        resource_updated_at=d.updated_at,
        source_object_type="device",
        source_object_id=d.id,
    )
    d = _load_device(db, d.id, user.customer_id)
    assert d
    return _device_reads_with_footprint(db, user, [d])[0]


@router.post("/import/validate", response_model=DeviceImportValidateResponse)
def validate_device_import(
    body: DeviceImportValidateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Server-side checks for a parsed CSV row set (duplicates, site access, existing names)."""
    log.debug("devices.validate_device_import rows=%s", len(body.rows))
    allowed = site_ids_with_permission(db, user, "devices.import")
    if allowed is not None and len(allowed) == 0:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No site allows device import for this user")
    ok, row_errors = validate_import_rows(db, user, body.rows, allowed)
    return DeviceImportValidateResponse(ok=ok, row_errors=row_errors, validated_row_count=len(body.rows))


@router.post("/import/commit", response_model=DeviceImportCommitResponse)
def commit_device_import_batch(
    body: DeviceImportCommitRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Persist devices from a validated import and record an audit row (success / partial / failed)."""
    log.debug("devices.commit_device_import rows=%s", len(body.rows))
    allowed = site_ids_with_permission(db, user, "devices.import")
    if allowed is not None and len(allowed) == 0:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No site allows device import for this user")
    return execute_device_import_commit(db, user, body.rows, body.source_label, allowed)


@router.get("/{device_id}", response_model=DeviceRead)
def get_device(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("devices.get_device %s", device_id)
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    return _device_reads_with_footprint(db, user, [device])[0]


@router.get("/{device_id}/footprint")
def get_device_footprint(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    ensure_site_permission(db, user, device.site_id, "devices.footprint.read")
    ep_by_de, dobjs = batch_load_footprint_sidecars(db, [device])
    dash_refs = batch_dashboard_references(db, customer_id=user.customer_id, device_ids={device.id})
    dash_counts = {device.id: len(dash_refs[device.id])}
    return build_device_footprint_payload(
        db,
        device,
        ep_by_de=ep_by_de,
        dobjs=dobjs,
        dashboard_counts=dash_counts,
        dashboard_ref_list=dash_refs[device.id],
    )


@router.get("/{device_id}/version-lineage", response_model=VersionLineageResponse)
def get_device_version_lineage(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Version timeline + KPI map from persisted lineage (§15); KPIs merge live footprint for current cut."""
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    ensure_site_permission_any(db, user, device.site_id, ("lineage.read", "devices.footprint.read"))
    ep_by_de, dobjs = batch_load_footprint_sidecars(db, [device])
    dash_refs = batch_dashboard_references(db, customer_id=user.customer_id, device_ids={device.id})
    dash_counts = {device.id: len(dash_refs[device.id])}
    fp = build_device_footprint_payload(
        db,
        device,
        ep_by_de=ep_by_de,
        dobjs=dobjs,
        dashboard_counts=dash_counts,
        dashboard_ref_list=dash_refs[device.id],
    )
    out = build_version_lineage_response(db, device, fp)
    db.commit()
    return out


@router.get("/{device_id}/device-versions", response_model=DeviceVersionSnapshotListResponse)
def list_device_version_snapshots_endpoint(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Immutable ``device_versions`` rows for Device Details → Versions tab (Phase 8)."""
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    ensure_site_permission(db, user, device.site_id, "device_versions.read")
    rows = list_device_version_snapshots(db, device_id)
    return DeviceVersionSnapshotListResponse(
        items=[DeviceVersionSnapshotRead.model_validate(r) for r in rows],
    )


@router.get("/{device_id}/device-versions/{version_id}/impact", response_model=DeviceVersionImpactResponse)
def get_device_version_impact_endpoint(
    device_id: uuid.UUID,
    version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Static impact v1: field diff vs prior active row + workflows + dashboards (Phase 9)."""
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    ensure_site_permission(db, user, device.site_id, "device_versions.read")
    candidate = db.get(DeviceVersion, version_id)
    if not candidate or candidate.device_id != device_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device version not found")
    raw = build_static_impact_payload(db, customer_id=user.customer_id, device=device, candidate=candidate)
    return DeviceVersionImpactResponse(
        device_id=raw["device_id"],
        candidate_id=raw["candidate_id"],
        baseline_id=raw["baseline_id"],
        field_diff=[VersionFieldDiffEntry(**x) for x in raw["field_diff"]],
        workflows=[ImpactWorkflowRef(**x) for x in raw["workflows"]],
        dashboards=[ImpactDashboardRef(**x) for x in raw["dashboards"]],
        catalog_attribute_ids=list(raw.get("catalog_attribute_ids") or []),
        widget_attribute_impact=[ImpactWidgetAttributeRow(**x) for x in raw.get("widget_attribute_impact") or []],
        notes=[DeviceVersionImpactNote(**x) for x in raw["notes"]],
    )


@router.get("/{device_id}/ota-target-history", response_model=DeviceOtaTargetHistoryResponse)
def list_device_ota_target_history_endpoint(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """OTA campaign targets involving this device (Phase 8 OTA History tab)."""
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    ensure_site_permission(db, user, device.site_id, "ota.read")
    rows = list_ota_target_history_for_device(
        db, customer_id=user.customer_id, device_id=device_id, limit=100
    )
    return DeviceOtaTargetHistoryResponse(
        items=[OtaTargetHistoryItem.model_validate(r) for r in rows],
    )


@router.patch("/{device_id}", response_model=DeviceRead)
def update_device(
    device_id: uuid.UUID,
    body: DeviceUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("devices.update_device %s", device_id)
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    ensure_site_permission(db, user, device.site_id, "devices.write")
    was_active = device.is_active
    prev_ota_supported = device.ota_supported
    old_device_version = (device.device_version or "").strip() or "1"

    if body.site_id is not None:
        site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
        if not site:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown site")
        if not user_may_access_site(user, body.site_id, allowed):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot move device to this site")
        ensure_site_permission(db, user, body.site_id, "devices.write")
        device.site_id = body.site_id

    if body.name is not None:
        device.name = body.name.strip()
    if body.description is not None:
        device.description = body.description
    if body.icon is not None:
        device.icon = body.icon
    if body.is_active is not None:
        device.is_active = body.is_active
    if body.polling_enabled is not None:
        device.polling_enabled = body.polling_enabled
    if body.expected_interval_seconds is not None:
        device.expected_interval_seconds = body.expected_interval_seconds
    if body.late_threshold_seconds is not None:
        device.late_threshold_seconds = body.late_threshold_seconds
    if body.offline_threshold_seconds is not None:
        device.offline_threshold_seconds = body.offline_threshold_seconds
    if body.firmware_version is not None:
        device.firmware_version = body.firmware_version
    if body.firmware_channel is not None:
        device.firmware_channel = body.firmware_channel
    if body.ota_supported is not None:
        device.ota_supported = body.ota_supported
    if body.rollback_supported is not None:
        device.rollback_supported = body.rollback_supported
    if body.device_version is not None:
        device.device_version = body.device_version.strip() or "1"
    if body.version_status is not None:
        device.version_status = body.version_status.strip() or "active"

    ota_changed = body.ota_supported is not None and device.ota_supported != prev_ota_supported
    if ota_changed:
        cur_ver = (device.device_version or "").strip() or "1"
        if cur_ver == old_device_version:
            device.device_version = bump_device_version_monotonic_label(old_device_version)

    new_device_version = (device.device_version or "").strip() or "1"
    version_label_changed = new_device_version != old_device_version

    db.add(device)
    db.flush()

    if version_label_changed:
        trigger = "explicit" if body.device_version is not None else ("ota" if ota_changed else "explicit")
        ep_by_de, dobjs = batch_load_footprint_sidecars(db, [device])
        dash_refs = batch_dashboard_references(db, customer_id=user.customer_id, device_ids={device.id})
        dash_counts = {device.id: len(dash_refs[device.id])}
        fp_snap = build_device_footprint_payload(
            db,
            device,
            ep_by_de=ep_by_de,
            dobjs=dobjs,
            dashboard_counts=dash_counts,
            dashboard_ref_list=dash_refs[device.id],
        )
        record_version_lineage_transition(
            db,
            device,
            previous_label=old_device_version,
            new_label=new_device_version,
            trigger_code=trigger,
            kpi_snapshot=kpi_snapshot_from_footprint_dict(fp_snap),
            ota_external_ref=None,
            created_by=user.id,
        )

    if body.device_version is not None or body.version_status is not None:
        emit_control_plane_audit(
            db,
            customer_id=user.customer_id,
            site_id=device.site_id,
            actor_user_id=user.id,
            action_type="manual_override",
            resource_type="device",
            resource_id=device.id,
            payload_json={
                "device_version": new_device_version,
                "version_status": device.version_status,
                "device_version_field_set": body.device_version is not None,
                "version_status_field_set": body.version_status is not None,
            },
        )

    db.commit()
    d = _load_device(db, device_id, user.customer_id)
    assert d
    db.refresh(d)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="updated",
        resource_type="Device",
        resource_label=d.name,
        site_id=d.site_id,
        device_id=d.id,
        resource_created_at=d.created_at,
        resource_updated_at=d.updated_at,
        source_object_type="device",
        source_object_id=d.id,
    )
    if body.is_active is False and was_active:
        try:
            emit_alert(
                db=db,
                category="device_health",
                severity="warning",
                title=f"Device marked inactive: {d.name}",
                message="Device is_active was set to false; telemetry may stop for this device.",
                customer_id=user.customer_id,
                site_id=d.site_id,
                device_id=d.id,
                source_component="api.devices",
                source_object_type="device",
                source_object_id=d.id,
                trace_id=None,
            )
        except Exception:
            log.debug("device inactive alert emit failed", exc_info=True)
    return _device_reads_with_footprint(db, user, [d])[0]


@router.get("/{device_id}/dependencies", response_model=DependenciesListResponse)
def get_device_dependencies(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    deps = device_delete_dependencies(db, customer_id=user.customer_id, device_id=device_id)
    return DependenciesListResponse(dependencies=deps)


@router.post("/{device_id}/deactivate")
def post_deactivate_device(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    ensure_site_permission(db, user, device.site_id, "devices.write")
    deactivate_device(db, device)
    db.commit()
    db.refresh(device)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="deactivated",
        resource_type="Device",
        resource_label=device.name,
        site_id=device.site_id,
        device_id=device.id,
        resource_created_at=device.created_at,
        resource_updated_at=device.updated_at,
        source_object_type="device",
        source_object_id=device.id,
    )
    return {"id": str(device.id), "operational_status": device.operational_status, "is_active": device.is_active}


@router.post("/{device_id}/reactivate")
def post_reactivate_device(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    ensure_site_permission(db, user, device.site_id, "devices.write")
    reactivate_device(db, device)
    db.commit()
    db.refresh(device)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="reactivated",
        resource_type="Device",
        resource_label=device.name,
        site_id=device.site_id,
        device_id=device.id,
        resource_created_at=device.created_at,
        resource_updated_at=device.updated_at,
        source_object_type="device",
        source_object_id=device.id,
    )
    return {"id": str(device.id), "operational_status": device.operational_status, "is_active": device.is_active}


@router.post("/{device_id}/archive")
def post_archive_device(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    ensure_site_permission(db, user, device.site_id, "devices.write")
    archive_device(db, device)
    db.commit()
    db.refresh(device)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="archived",
        resource_type="Device",
        resource_label=device.name,
        site_id=device.site_id,
        device_id=device.id,
        resource_created_at=device.created_at,
        resource_updated_at=device.updated_at,
        source_object_type="device",
        source_object_id=device.id,
    )
    return {"id": str(device.id), "operational_status": device.operational_status, "is_active": device.is_active}


@router.delete("/{device_id}", response_model=DeviceDeleteResponse)
def delete_device(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("devices.delete_device %s", device_id)
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    ensure_site_permission(db, user, device.site_id, "devices.write")

    deps = device_delete_dependencies(db, customer_id=user.customer_id, device_id=device_id)
    raise_conflict_if_in_use(
        deps,
        message="Device cannot be deleted while dependencies exist",
        deactivate_url=f"/devices/{device_id}/deactivate",
    )

    db.delete(device)
    db.commit()

    pipeline_emit(
        log,
        component="api.devices",
        action="deleted",
        status="ok",
        device_id=str(device_id),
        site_id=str(device.site_id),
    )

    return DeviceDeleteResponse()


@router.post("/{device_id}/polling/stop", response_model=DeviceRead)
def polling_stop(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return update_device(device_id, DeviceUpdate(polling_enabled=False), user, db)


@router.post("/{device_id}/polling/start", response_model=DeviceRead)
def polling_start(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return update_device(device_id, DeviceUpdate(polling_enabled=True), user, db)
