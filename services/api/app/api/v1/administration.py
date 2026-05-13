import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.access_control import ensure_site_in_tenant
from app.api.deps import get_current_user, require_admin
from app.core.pipeline_log import emit as pipeline_emit
from app.core.security import hash_password, verify_password
from app.db.session import get_db
from app.models.customer import Customer
from app.models.site import Site
from app.models.user import User
from app.models.user_site import UserSite
from app.schemas.integrity import DependenciesListResponse, raise_conflict_if_in_use
from app.schemas.site import SiteCreate, SiteRead
from app.schemas.user_admin import UserCreate, UserRead
from app.services.dependency_service import site_delete_dependencies
from app.services.permission_service import (
    role_id_for_key,
    site_ids_with_any_active_binding,
    upsert_site_user_role,
    upsert_tenant_user_role,
)
from app.services.functional_audit_alert import emit_functional_audit_alert
from app.services.lifecycle_actions import archive_site, deactivate_site, reactivate_site
from app.services.tenant_data_clear import clear_operational_data_except_sites

router = APIRouter()
log = logging.getLogger(__name__)


class FullResetBody(BaseModel):
    password: str = Field(..., min_length=1)
    confirmation_phrase: str = Field(..., description='Must equal RESET AAR-IOT-STUDIO')


class TenantOperationalDataClearBody(BaseModel):
    """Re-enter your password and the exact confirmation phrase."""

    password: str = Field(..., min_length=1)
    confirmation_phrase: str = Field(
        ...,
        description="Must match exactly: DELETE ALL DATA EXCEPT SITES",
    )
    async_execution: bool = Field(
        False,
        description="If true, enqueue a background clear and return 202 + job_id (requires Redis).",
    )


class TenantOperationalDataClearResponse(BaseModel):
    deleted_counts: dict[str, int]


class TenantOperationalDataClearJobAccepted(BaseModel):
    job_id: str
    status: str
    poll_path: str


class TenantOperationalDataClearJobStatus(BaseModel):
    job_id: str
    customer_id: str
    status: str
    phase: str
    deleted_counts: dict[str, int]
    error: str | None
    created_at: float
    updated_at: float


class CustomerTenantUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


def _user_to_read(user: User) -> UserRead:
    base = UserRead.model_validate(user)
    return base.model_copy(update={"site_ids": [s.site_id for s in user.site_links]})


@router.get("/users", response_model=list[UserRead])
def list_users(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    log.debug("administration.list_users")
    rows = db.scalars(
        select(User)
        .options(joinedload(User.site_links))
        .where(User.customer_id == admin.customer_id)
        .order_by(User.email)
    ).unique().all()
    return [_user_to_read(u) for u in rows]


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    log.debug("administration.create_user email=%r", body.email)
    email = body.email.lower().strip()
    if db.execute(select(User).where(User.email == email)).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    for sid in body.site_ids:
        if not ensure_site_in_tenant(db, admin.customer_id, sid):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown site_id {sid}")

    user = User(
        id=uuid.uuid4(),
        customer_id=admin.customer_id,
        email=email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
        is_active=True,
        is_superuser=False,
        role=body.role,
        must_change_password=False,
    )
    db.add(user)
    db.flush()
    for sid in body.site_ids:
        db.add(UserSite(user_id=user.id, site_id=sid))
    if body.role == "admin":
        rid = role_id_for_key(db, "customer_admin")
        if rid:
            upsert_tenant_user_role(
                db,
                customer_id=admin.customer_id,
                user_id=user.id,
                role_id=rid,
                created_by=admin.id,
            )
    else:
        rk_do = "device_operator"
        rid_do = role_id_for_key(db, rk_do)
        if rid_do:
            for sid in body.site_ids:
                upsert_site_user_role(
                    db, site_id=sid, user_id=user.id, role_id=rid_do, created_by=admin.id
                )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Could not create user") from None
    user = db.execute(
        select(User).options(joinedload(User.site_links)).where(User.id == user.id)
    ).scalar_one()
    uid = user.id
    emit_functional_audit_alert(
        db,
        customer_id=admin.customer_id,
        actor=admin,
        verb="created",
        resource_type="User",
        resource_label=user.email,
        site_id=None,
        device_id=None,
        resource_created_at=user.created_at,
        resource_updated_at=user.updated_at,
        source_object_type="user",
        source_object_id=uid,
    )
    user = db.execute(
        select(User).options(joinedload(User.site_links)).where(User.id == uid)
    ).scalar_one()
    return _user_to_read(user)


@router.get("/sites", response_model=list[SiteRead])
def list_sites(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("administration.list_sites")
    ids = site_ids_with_any_active_binding(db, user)
    if ids is None:
        rows = db.scalars(
            select(Site)
            .where(Site.customer_id == user.customer_id)
            .order_by(Site.name)
        ).all()
        return [SiteRead.model_validate(s) for s in rows]
    if not ids:
        return []
    rows = db.scalars(select(Site).where(Site.id.in_(ids)).order_by(Site.name)).all()
    return [SiteRead.model_validate(s) for s in rows]


@router.post("/sites", response_model=SiteRead, status_code=status.HTTP_201_CREATED)
def create_site(
    body: SiteCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    log.debug("administration.create_site name=%r", body.name)
    site = Site(
        id=uuid.uuid4(),
        customer_id=admin.customer_id,
        name=body.name.strip(),
        description=body.description,
    )
    db.add(site)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Site name already exists for this customer"
        ) from None
    db.refresh(site)
    sid = site.id
    emit_functional_audit_alert(
        db,
        customer_id=admin.customer_id,
        actor=admin,
        verb="created",
        resource_type="Site",
        resource_label=site.name,
        site_id=sid,
        device_id=None,
        resource_created_at=site.created_at,
        resource_updated_at=site.updated_at,
        source_object_type="site",
        source_object_id=sid,
    )
    site = db.get(Site, sid)
    assert site is not None
    return SiteRead.model_validate(site)


@router.get("/sites/{site_id}/dependencies", response_model=DependenciesListResponse)
def get_site_dependencies(
    site_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    site = db.get(Site, site_id)
    if not site or site.customer_id != admin.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    deps = site_delete_dependencies(db, customer_id=admin.customer_id, site_id=site_id)
    return DependenciesListResponse(dependencies=deps)


@router.post("/sites/{site_id}/deactivate")
def post_deactivate_site(
    site_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    site = db.get(Site, site_id)
    if not site or site.customer_id != admin.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    deactivate_site(db, site)
    db.commit()
    db.refresh(site)
    emit_functional_audit_alert(
        db,
        customer_id=admin.customer_id,
        actor=admin,
        verb="deactivated",
        resource_type="Site",
        resource_label=site.name,
        site_id=site.id,
        device_id=None,
        resource_created_at=site.created_at,
        resource_updated_at=site.updated_at,
        source_object_type="site",
        source_object_id=site.id,
    )
    return {"id": str(site.id), "operational_status": site.operational_status}


@router.post("/sites/{site_id}/reactivate")
def post_reactivate_site(
    site_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    site = db.get(Site, site_id)
    if not site or site.customer_id != admin.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    reactivate_site(db, site)
    db.commit()
    db.refresh(site)
    emit_functional_audit_alert(
        db,
        customer_id=admin.customer_id,
        actor=admin,
        verb="reactivated",
        resource_type="Site",
        resource_label=site.name,
        site_id=site.id,
        device_id=None,
        resource_created_at=site.created_at,
        resource_updated_at=site.updated_at,
        source_object_type="site",
        source_object_id=site.id,
    )
    return {"id": str(site.id), "operational_status": site.operational_status}


@router.post("/sites/{site_id}/archive")
def post_archive_site(
    site_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    site = db.get(Site, site_id)
    if not site or site.customer_id != admin.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    archive_site(db, site)
    db.commit()
    db.refresh(site)
    emit_functional_audit_alert(
        db,
        customer_id=admin.customer_id,
        actor=admin,
        verb="archived",
        resource_type="Site",
        resource_label=site.name,
        site_id=site.id,
        device_id=None,
        resource_created_at=site.created_at,
        resource_updated_at=site.updated_at,
        source_object_type="site",
        source_object_id=site.id,
    )
    return {"id": str(site.id), "operational_status": site.operational_status}


@router.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site(
    site_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    log.debug("administration.delete_site site_id=%s", site_id)
    site = db.get(Site, site_id)
    if not site or site.customer_id != admin.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    deps = site_delete_dependencies(db, customer_id=admin.customer_id, site_id=site_id)
    raise_conflict_if_in_use(
        deps,
        message="Site cannot be deleted while dependencies exist",
        deactivate_url=f"/administration/sites/{site_id}/deactivate",
    )
    emit_functional_audit_alert(
        db,
        customer_id=admin.customer_id,
        actor=admin,
        verb="deleted",
        resource_type="Site",
        resource_label=site.name,
        site_id=site.id,
        device_id=None,
        resource_created_at=site.created_at,
        resource_updated_at=site.updated_at,
        source_object_type="site",
        source_object_id=site.id,
    )
    db.delete(site)
    db.commit()
    return None


@router.patch("/customer")
def patch_customer_name(
    body: CustomerTenantUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Rename this tenant (e.g. replace bootstrap \"Default customer\" during onboarding)."""
    cust = db.get(Customer, admin.customer_id)
    if not cust:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    cust.name = body.name.strip()
    db.add(cust)
    db.commit()
    db.refresh(cust)
    return {"id": str(cust.id), "name": cust.name}


@router.post(
    "/clear-operational-data",
    responses={
        200: {"model": TenantOperationalDataClearResponse},
        202: {"model": TenantOperationalDataClearJobAccepted},
    },
)
def post_clear_operational_data(
    body: TenantOperationalDataClearBody,
    background_tasks: BackgroundTasks,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Remove devices, raw/data objects, workflows (including result objects), dashboards, alerts,
    published services, and static ingestion rows for this tenant. **Sites, users, and customer
    configuration are kept.** Requires the admin's current password.

    Set ``async_execution`` to true to return **202** immediately with a ``job_id`` (stored in Redis);
    poll ``GET /administration/clear-operational-data/jobs/{job_id}`` until ``status`` is
    ``completed`` or ``failed``. Async mode requires Redis.
    """
    expected = "DELETE ALL DATA EXCEPT SITES"
    phrase = body.confirmation_phrase.strip()
    if phrase != expected:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f'confirmation_phrase must equal exactly: {expected!r} (leading/trailing spaces are ignored)',
        )
    if not verify_password(body.password, admin.hashed_password):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid password")

    if body.async_execution:
        from app.services.tenant_operational_clear_job import (
            create_job,
            redis_available,
            run_clear_job,
        )

        if not redis_available():
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Async operational clear requires Redis. Retry with async_execution=false, "
                "or start the Redis service.",
            )
        job_id = create_job(admin.customer_id)
        background_tasks.add_task(run_clear_job, job_id, admin.customer_id)
        poll_path = f"/administration/clear-operational-data/jobs/{job_id}"
        pipeline_emit(
            log,
            component="api.administration",
            action="clear_operational_data_async",
            status="accepted",
            customer_id=str(admin.customer_id),
            job_id=job_id,
        )
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content=TenantOperationalDataClearJobAccepted(
                job_id=job_id,
                status="accepted",
                poll_path=poll_path,
            ).model_dump(),
        )

    try:
        stats = clear_operational_data_except_sites(db, admin.customer_id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    pipeline_emit(
        log,
        component="api.administration",
        action="clear_operational_data",
        status="ok",
        customer_id=str(admin.customer_id),
    )
    return TenantOperationalDataClearResponse(deleted_counts=stats)


@router.get(
    "/clear-operational-data/jobs/{job_id}",
    response_model=TenantOperationalDataClearJobStatus,
)
def get_clear_operational_data_job(
    job_id: str,
    admin: User = Depends(require_admin),
):
    """Poll async operational clear status (same tenant as the admin)."""
    from app.services.tenant_operational_clear_job import get_job

    data = get_job(job_id, customer_id=admin.customer_id)
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown job_id or job expired")
    return TenantOperationalDataClearJobStatus.model_validate(data)


@router.post("/restore")
def restore_full_reset(
    body: FullResetBody,
    _admin: User = Depends(require_admin),
):
    log.debug("administration.restore_full_reset")
    expected = "RESET AAR-IOT-STUDIO"
    if body.confirmation_phrase.strip() != expected:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "confirmation_phrase must match exactly")
    raise HTTPException(
        status.HTTP_501_NOT_IMPLEMENTED,
        detail="Full deployment reset not yet implemented — validate password + orchestration",
    )
