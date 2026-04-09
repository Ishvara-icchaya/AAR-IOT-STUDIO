import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.pipeline_log import emit as pipeline_emit
from app.db.session import get_db
from app.models.user import User
from app.schemas.published_service import (
    PublishedServiceCreate,
    PublishedServiceDeliveryLogListResponse,
    PublishedServiceDetailResponse,
    PublishedServiceListResponse,
    PublishedServiceRead,
    PublishedServiceSourcesDataObjectsResponse,
    PublishedServiceSourcesResultObjectsResponse,
    PublishedServiceTestResponse,
    PublishedServiceUpdate,
    PublishedTargetDefaultsResponse,
)
from app.services.port_config_service import get_publish_target_defaults
from app.services.published_service_service import (
    PublishedServiceForbidden,
    PublishedServiceNotFound,
    create_service,
    delete_service,
    get_service,
    get_service_detail,
    list_data_object_sources,
    list_delivery_logs,
    list_result_object_sources,
    list_services,
    set_status,
    update_service,
)
from app.services.published_service_test_service import run_test_publish

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("/sources/data-objects", response_model=PublishedServiceSourcesDataObjectsResponse)
def sources_data_objects(
    site_id: uuid.UUID = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return list_data_object_sources(db, user, site_id)
    except PublishedServiceForbidden:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    except ValueError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))


@router.get("/sources/result-objects", response_model=PublishedServiceSourcesResultObjectsResponse)
def sources_result_objects(
    site_id: uuid.UUID = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return list_result_object_sources(db, user, site_id)
    except PublishedServiceForbidden:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    except ValueError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))


@router.get("", response_model=PublishedServiceListResponse)
def list_published(
    site_id: uuid.UUID | None = None,
    status: str | None = None,
    publish_protocol: str | None = None,
    search: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        out = list_services(
            db,
            user,
            site_id=site_id,
            status=status,
            publish_protocol=publish_protocol,
            search=search,
        )
    except PublishedServiceForbidden:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    pipeline_emit(log, component="api.published_services", action="list", status="ok", count=len(out.items))
    return out


@router.get("/defaults/targets", response_model=PublishedTargetDefaultsResponse)
def published_target_defaults(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rest, mqtt = get_publish_target_defaults(db, user.customer_id)
    return PublishedTargetDefaultsResponse(rest_target_config_json=rest, mqtt_target_config_json=mqtt)


@router.post("", response_model=PublishedServiceRead, status_code=status.HTTP_201_CREATED)
def create_published(
    body: PublishedServiceCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        row = create_service(db, user, body)
    except PublishedServiceForbidden:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    pipeline_emit(log, component="api.published_services", action="created", status="ok", service_id=str(row.id))
    return PublishedServiceRead.model_validate(row)


@router.get("/{service_id}/detail", response_model=PublishedServiceDetailResponse)
def get_published_detail(
    service_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    out = get_service_detail(db, user, service_id, log_limit=limit)
    if not out:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    return out


@router.get("/{service_id}", response_model=PublishedServiceRead)
def get_published(
    service_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = get_service(db, user, service_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    return PublishedServiceRead.model_validate(row)


@router.put("/{service_id}", response_model=PublishedServiceRead)
def update_published(
    service_id: uuid.UUID,
    body: PublishedServiceUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        row = update_service(db, user, service_id, body)
    except PublishedServiceForbidden:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    pipeline_emit(log, component="api.published_services", action="updated", status="ok", service_id=str(service_id))
    return PublishedServiceRead.model_validate(row)


@router.delete("/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_published(
    service_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not delete_service(db, user, service_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    pipeline_emit(log, component="api.published_services", action="deleted", status="ok", service_id=str(service_id))
    return None


@router.post("/{service_id}/start", response_model=PublishedServiceRead)
def start_published(
    service_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = set_status(db, user, service_id, "active")
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    pipeline_emit(log, component="api.published_services", action="start", status="ok", service_id=str(service_id))
    return PublishedServiceRead.model_validate(row)


@router.post("/{service_id}/stop", response_model=PublishedServiceRead)
def stop_published(
    service_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = set_status(db, user, service_id, "stopped")
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    pipeline_emit(log, component="api.published_services", action="stop", status="ok", service_id=str(service_id))
    return PublishedServiceRead.model_validate(row)


@router.post("/{service_id}/restart", response_model=PublishedServiceRead)
def restart_published(
    service_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = get_service(db, user, service_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    row.status = "active"
    row.last_error_message = None
    db.add(row)
    db.commit()
    db.refresh(row)
    pipeline_emit(log, component="api.published_services", action="restart", status="ok", service_id=str(service_id))
    return PublishedServiceRead.model_validate(row)


@router.post("/{service_id}/test", response_model=PublishedServiceTestResponse)
def test_published(
    service_id: uuid.UUID,
    trace_id: str | None = Query(None, max_length=128),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        out = run_test_publish(db, user, service_id, trace_id=trace_id)
    except PublishedServiceNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    pipeline_emit(
        log,
        component="api.published_services",
        action="test",
        status="ok" if out.ok else "error",
        service_id=str(service_id),
    )
    return out


@router.get("/{service_id}/delivery-logs", response_model=PublishedServiceDeliveryLogListResponse)
def delivery_logs(
    service_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return list_delivery_logs(db, user, service_id, limit=limit)
    except PublishedServiceNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
