import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, user_may_access_site
from app.api.deps import get_current_user
from app.core.data_object_lifecycle import DATA_PUBLISHED
from app.core.pipeline_log import emit as pipeline_emit
from app.db.session import get_db
from app.models.data_object import DataObject
from app.models.device import Device
from app.models.device_object import DeviceObject
from app.models.raw_data_object import RawDataObject
from app.models.site import Site
from app.models.user import User
from app.schemas.data_object import DataObjectListResponse, DataObjectRead
from app.schemas.scrubber_generate_health import GenerateHealthMappingRequest, GenerateHealthMappingResponse
from app.schemas.scrubber_test_llm import TestLlmOverlayRequest, TestLlmOverlayResponse
from app.schemas.scrubber_preview import ScrubberPreviewRequest, ScrubberPreviewResponse
from app.schemas.scrubber_stale_ingestion import (
    StaleIngestionDeviceItem,
    StaleIngestionDeviceListResponse,
)
from app.services.dashboard_dependency_service import (
    check_data_object_in_use,
    resource_in_use_detail,
)
from app.services.scrubber_engine import apply_llm_health_kpi_overlay_public
from app.services.scrubber_generate_health_service import generate_health_mapping
from app.services.scrubber_preview_service import scrubber_preview

router = APIRouter()
log = logging.getLogger(__name__)


def _mapping_has_scrubber_draft(mapping: dict) -> bool:
    ss = mapping.get("scrubberStudio")
    if not isinstance(ss, dict):
        return False
    d = ss.get("draft")
    return isinstance(d, dict) and len(d) > 0


def _scrubber_version_from_mapping(mapping: dict) -> str | None:
    ss = mapping.get("scrubberStudio")
    if not isinstance(ss, dict):
        return None
    v = ss.get("version")
    if v is None:
        return None
    s = str(v).strip()
    return s or None


@router.post("/preview", response_model=ScrubberPreviewResponse)
def post_scrubber_preview(
    body: ScrubberPreviewRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Run scrubber transform against the real raw MinIO payload (same engine as worker-scrubber)."""
    log.debug("scrubber.preview raw_object_id=%s", body.raw_object_id)
    out = scrubber_preview(db=db, user=user, body=body)
    pipeline_emit(
        log,
        component="api.scrubber",
        action="preview",
        status="ok" if not out.error else "error",
        raw_object_id=str(out.raw_object_id),
    )
    return out


@router.post("/generate-health-mapping", response_model=GenerateHealthMappingResponse)
def post_generate_health_mapping(
    body: GenerateHealthMappingRequest,
    user: User = Depends(get_current_user),
):
    """Use Ollama to propose health rules + optional llmHealthKpi from mapping and live/compiled snapshots."""
    log.debug("scrubber.generate_health_mapping")
    out = generate_health_mapping(
        prompt=body.prompt,
        mapping_draft=body.mapping_draft,
        live_snapshot=body.live_snapshot,
        compiled_snapshot=body.compiled_snapshot,
    )
    if out.get("error"):
        return GenerateHealthMappingResponse(
            error=str(out["error"]),
            rationale=out.get("rationale"),
        )
    return GenerateHealthMappingResponse(
        health_mode=str(out.get("health_mode") or "rules"),
        health_rules=list(out.get("health_rules") or []),
        health_fixed=out.get("health_fixed"),
        llm_health_kpi=out.get("llm_health_kpi"),
        rationale=out.get("rationale"),
        error=None,
    )


@router.post("/test-llm-overlay", response_model=TestLlmOverlayResponse)
def post_test_llm_overlay(
    body: TestLlmOverlayRequest,
    user: User = Depends(get_current_user),
):
    """Run only the LLM KPI/health overlay on a provided result snapshot (Ollama)."""
    log.debug("scrubber.test_llm_overlay")
    try:
        kpi, hs, hc, hm = apply_llm_health_kpi_overlay_public(
            body.mapping_draft,
            body.output_payload,
            body.kpi,
            body.health_status,
            body.health_code,
            body.health_message,
        )
        return TestLlmOverlayResponse(
            kpi=kpi if isinstance(kpi, dict) else {},
            health_status=hs,
            health_code=hc,
            health_message=hm,
            error=None,
        )
    except Exception as e:
        return TestLlmOverlayResponse(error=str(e)[:2000])


@router.get("/data-objects", response_model=DataObjectListResponse)
def list_data_objects(
    device_id: uuid.UUID | None = Query(None),
    for_workflow: bool = Query(
        False,
        description="When true, return only lifecycle_status=published rows (workflow / downstream consumers)",
    ),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("scrubber.list_data_objects")
    allowed = allowed_site_ids_for_user(db, user)
    if allowed is not None and len(allowed) == 0:
        return DataObjectListResponse(items=[])

    stmt = (
        select(DataObject)
        .join(Device, Device.id == DataObject.device_id)
        .where(DataObject.customer_id == user.customer_id)
        .order_by(DataObject.created_at.desc())
        .limit(limit)
    )
    if device_id is not None:
        stmt = stmt.where(DataObject.device_id == device_id)
    if for_workflow:
        stmt = stmt.where(DataObject.lifecycle_status == DATA_PUBLISHED)
    if allowed is not None:
        stmt = stmt.where(Device.site_id.in_(allowed))

    rows = list(db.scalars(stmt).all())
    out = [DataObjectRead.model_validate(r) for r in rows]

    pipeline_emit(
        log,
        component="api.scrubber",
        action="list_data_objects",
        status="ok",
        count=len(out),
    )
    return DataObjectListResponse(items=out)


@router.get("/data-objects/{data_object_id}", response_model=DataObjectRead)
def get_data_object(
    data_object_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Single data object (payload + KPI) for workflow preview and tooling."""
    row = db.get(DataObject, data_object_id)
    if not row or row.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "data_object not found")
    dev = db.get(Device, row.device_id)
    if not dev:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "device not found")
    allowed = allowed_site_ids_for_user(db, user)
    if allowed is not None and dev.site_id not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    pipeline_emit(
        log,
        component="api.scrubber",
        action="get_data_object",
        status="ok",
        data_object_id=str(data_object_id),
    )
    return DataObjectRead.model_validate(row)


@router.get("/devices-stale-ingestion", response_model=StaleIngestionDeviceListResponse)
def list_devices_stale_ingestion(
    stale_after_hours: float = Query(
        24,
        ge=0.5,
        le=8760,
        description="Devices with no raw, or newest raw older than this (UTC), are listed.",
    ),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Devices that have a non-empty scrubberStudio draft but no recent raw ingestion."""
    log.debug("scrubber.devices_stale_ingestion stale_after_hours=%s", stale_after_hours)
    allowed = allowed_site_ids_for_user(db, user)
    if allowed is not None and len(allowed) == 0:
        return StaleIngestionDeviceListResponse(items=[], stale_after_hours=stale_after_hours)

    stmt = (
        select(Device, DeviceObject, Site.name)
        .join(DeviceObject, DeviceObject.device_id == Device.id)
        .join(Site, Site.id == Device.site_id)
        .where(Device.customer_id == user.customer_id)
        .order_by(Device.name.asc())
    )
    if allowed is not None:
        stmt = stmt.where(Device.site_id.in_(allowed))

    candidates: list[tuple[Device, DeviceObject, str]] = []
    for device, do, site_name in db.execute(stmt).all():
        m = do.mapping if isinstance(do.mapping, dict) else {}
        if not _mapping_has_scrubber_draft(m):
            continue
        candidates.append((device, do, site_name or ""))

    if not candidates:
        return StaleIngestionDeviceListResponse(items=[], stale_after_hours=stale_after_hours)

    device_ids = [d.id for d, _, _ in candidates]

    mx_stmt = (
        select(RawDataObject.device_id, func.max(RawDataObject.ingested_at))
        .where(RawDataObject.device_id.in_(device_ids))
        .group_by(RawDataObject.device_id)
    )
    latest_at_by_device = {row[0]: row[1] for row in db.execute(mx_stmt).all()}

    cnt_stmt = (
        select(RawDataObject.device_id, func.count())
        .where(RawDataObject.device_id.in_(device_ids))
        .group_by(RawDataObject.device_id)
    )
    count_by_device = {row[0]: int(row[1]) for row in db.execute(cnt_stmt).all()}

    cutoff = datetime.now(timezone.utc) - timedelta(hours=stale_after_hours)

    stale_rows: list[tuple[Device, DeviceObject, str]] = []
    for device, do, site_name in candidates:
        lat = latest_at_by_device.get(device.id)
        if lat is not None and lat >= cutoff:
            continue
        stale_rows.append((device, do, site_name))

    out: list[StaleIngestionDeviceItem] = []
    for device, do, site_name in stale_rows[:limit]:
        m = do.mapping if isinstance(do.mapping, dict) else {}
        latest = db.scalar(
            select(RawDataObject)
            .where(RawDataObject.device_id == device.id)
            .order_by(RawDataObject.ingested_at.desc(), RawDataObject.id.desc())
            .limit(1)
        )
        latest_at = latest.ingested_at if latest else None
        out.append(
            StaleIngestionDeviceItem(
                device_id=device.id,
                device_name=device.name,
                site_id=device.site_id,
                site_name=site_name,
                scrubber_version=_scrubber_version_from_mapping(m),
                latest_raw_id=latest.id if latest else None,
                latest_raw_ingested_at=latest_at,
                raw_object_count=count_by_device.get(device.id, 0),
            )
        )

    pipeline_emit(
        log,
        component="api.scrubber",
        action="devices_stale_ingestion",
        status="ok",
        count=len(out),
    )
    return StaleIngestionDeviceListResponse(items=out, stale_after_hours=stale_after_hours)


@router.delete("/data-objects/{data_object_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_data_object(
    data_object_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(DataObject, data_object_id)
    if not row or row.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "data_object not found")
    device = db.get(Device, row.device_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found for data_object")
    allowed = allowed_site_ids_for_user(db, user)
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    blocked = check_data_object_in_use(db, customer_id=user.customer_id, data_object_id=data_object_id)
    if blocked:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=resource_in_use_detail(resource_label="data object", dashboards=blocked),
        )
    db.delete(row)
    db.commit()
    pipeline_emit(
        log,
        component="api.scrubber",
        action="delete_data_object",
        status="ok",
        data_object_id=str(data_object_id),
    )
    return None
