import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access_control import user_may_access_site
from app.services.permission_service import ensure_site_permission, site_ids_with_permission
from app.api.deps import get_current_user
from app.api.v1.devices import _load_device
from app.db.session import get_db
from app.models.device_object import DeviceObject
from app.models.user import User
from app.schemas.device_object import (
    DeviceObjectPatch,
    DeviceObjectRead,
    merge_device_object_mapping,
)
from app.services.device_operational_footprint_service import (
    batch_dashboard_references,
    batch_load_footprint_sidecars,
    build_device_footprint_payload,
    ingest_contract_fingerprint,
)
from app.services.device_version_lineage_service import (
    bump_device_version_monotonic_label,
    kpi_snapshot_from_footprint_dict,
    record_version_lineage_transition,
)
from app.services.endpoint_scrubber_semantics_identity_sync import sync_v2_endpoint_identity_from_device_mapping
from app.services.field_catalog_service import validate_field_catalog

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("", response_model=DeviceObjectRead)
def get_device_object(
    device_id: uuid.UUID = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("device_objects.get device_id=%s", device_id)
    allowed = site_ids_with_permission(db, user, "devices.read")
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    row = db.execute(
        select(DeviceObject).where(DeviceObject.device_id == device_id)
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "device_object missing")
    return DeviceObjectRead.model_validate(row)


@router.patch("", response_model=DeviceObjectRead)
def patch_device_object(
    body: DeviceObjectPatch,
    device_id: uuid.UUID = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("device_objects.patch device_id=%s", device_id)
    allowed = site_ids_with_permission(db, user, "devices.read")
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    row = db.execute(
        select(DeviceObject).where(DeviceObject.device_id == device_id)
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "device_object missing")

    existing = row.mapping if isinstance(row.mapping, dict) else {}
    fp_sig_old = ingest_contract_fingerprint(existing)
    patch_mapping = body.mapping if isinstance(body.mapping, dict) else {}
    patch_ss = patch_mapping.get("scrubberStudio") if isinstance(patch_mapping, dict) else None
    freeze_publish = isinstance(patch_ss, dict) and patch_ss.get("published") is True
    row.mapping = merge_device_object_mapping(existing, body.mapping)
    fc = row.mapping.get("fieldCatalog") if isinstance(row.mapping, dict) else None
    if isinstance(fc, dict):
        errs, warns = validate_field_catalog(fc)
        for w in warns:
            log.warning("device_objects.fieldCatalog device_id=%s %s", device_id, w)
        if errs:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(errs))
    fp_sig_new = ingest_contract_fingerprint(row.mapping if isinstance(row.mapping, dict) else {})
    contract_changed = fp_sig_old != fp_sig_new
    if contract_changed:
        ensure_site_permission(db, user, device.site_id, "devices.write")

    db.add(row)
    db.flush()

    if contract_changed:
        old_v = (device.device_version or "").strip() or "1"
        new_v = bump_device_version_monotonic_label(old_v)
        device.device_version = new_v
        db.add(device)
        db.flush()
        ep_by_de, dobjs = batch_load_footprint_sidecars(db, [device])
        dash_refs = batch_dashboard_references(db, customer_id=device.customer_id, device_ids={device.id})
        fp_snap = build_device_footprint_payload(
            db,
            device,
            ep_by_de=ep_by_de,
            dobjs=dobjs,
            dashboard_counts={device.id: len(dash_refs[device.id])},
            dashboard_ref_list=dash_refs[device.id],
        )
        record_version_lineage_transition(
            db,
            device,
            previous_label=old_v,
            new_label=new_v,
            trigger_code="ingest_shape",
            kpi_snapshot=kpi_snapshot_from_footprint_dict(fp_snap),
            ota_external_ref=None,
            created_by=user.id,
            payload_json={"kind": "device_object_mapping", "device_object_id": str(row.id)},
        )

    if freeze_publish and isinstance(row.mapping, dict):
        sync_v2_endpoint_identity_from_device_mapping(
            db,
            device_id=device_id,
            merged_mapping=row.mapping,
            device_customer_id=device.customer_id,
        )
    db.commit()
    db.refresh(row)
    return DeviceObjectRead.model_validate(row)
