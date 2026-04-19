import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
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


class TenantOperationalDataClearResponse(BaseModel):
    deleted_counts: dict[str, int]


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
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Could not create user") from None
    user = db.execute(
        select(User).options(joinedload(User.site_links)).where(User.id == user.id)
    ).scalar_one()
    return _user_to_read(user)


@router.get("/sites", response_model=list[SiteRead])
def list_sites(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("administration.list_sites")
    if user.is_superuser or user.role == "admin":
        rows = db.scalars(
            select(Site)
            .where(Site.customer_id == user.customer_id)
            .order_by(Site.name)
        ).all()
        return [SiteRead.model_validate(s) for s in rows]
    ids = [l.site_id for l in user.site_links]
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


@router.post("/clear-operational-data", response_model=TenantOperationalDataClearResponse)
def post_clear_operational_data(
    body: TenantOperationalDataClearBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Remove devices, raw/data objects, workflows (including result objects), dashboards, alerts,
    published services, and static ingestion rows for this tenant. **Sites, users, and customer
    configuration are kept.** Requires the admin's current password.
    """
    expected = "DELETE ALL DATA EXCEPT SITES"
    if body.confirmation_phrase != expected:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "confirmation_phrase must match exactly (including spaces)",
        )
    if not verify_password(body.password, admin.hashed_password):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid password")
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


@router.post("/restore")
def restore_full_reset(
    body: FullResetBody,
    _admin: User = Depends(require_admin),
):
    log.debug("administration.restore_full_reset")
    expected = "RESET AAR-IOT-STUDIO"
    if body.confirmation_phrase != expected:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "confirmation_phrase must match exactly")
    raise HTTPException(
        status.HTTP_501_NOT_IMPLEMENTED,
        detail="Full deployment reset not yet implemented — validate password + orchestration",
    )
