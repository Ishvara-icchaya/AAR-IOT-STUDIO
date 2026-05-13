import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.mask import mask_email
from app.core.pipeline_log import emit as pipeline_emit
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import ChangePasswordRequest, LoginRequest, TokenResponse

router = APIRouter()
log = logging.getLogger(__name__)


class MeResponse(BaseModel):
    id: str
    email: str
    role: str
    customer_id: str
    is_superuser: bool
    must_change_password: bool
    customer_name: str
    needs_customer_setup: bool


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    t0 = time.perf_counter()
    pipeline_emit(
        log,
        component="api.auth",
        action="login",
        status="started",
        email_masked=mask_email(body.email),
    )
    user = db.execute(select(User).where(User.email == body.email.lower().strip())).scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        pipeline_emit(
            log,
            component="api.auth",
            action="login",
            status="denied",
            duration_ms=(time.perf_counter() - t0) * 1000,
            reason="invalid_credentials",
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if not user.is_active:
        pipeline_emit(
            log,
            component="api.auth",
            action="login",
            status="denied",
            duration_ms=(time.perf_counter() - t0) * 1000,
            reason="inactive_user",
        )
        raise HTTPException(status.HTTP_403_FORBIDDEN, "User is inactive")
    if user.account_status == "disabled":
        pipeline_emit(
            log,
            component="api.auth",
            action="login",
            status="denied",
            duration_ms=(time.perf_counter() - t0) * 1000,
            reason="disabled_user",
        )
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")
    user.last_login_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    token = create_access_token(
        str(user.id),
        extra={"cid": str(user.customer_id), "email": user.email, "role": user.role},
    )
    pipeline_emit(
        log,
        component="api.auth",
        action="login",
        status="ok",
        duration_ms=(time.perf_counter() - t0) * 1000,
        user_id=str(user.id),
        customer_id=str(user.customer_id),
    )
    return TokenResponse(access_token=token)


def _needs_customer_setup(customer_name: str | None) -> bool:
    return (customer_name or "").strip().lower() == "default customer"


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)):
    cname = user.customer.name if user.customer else ""
    return MeResponse(
        id=str(user.id),
        email=user.email,
        role=user.role,
        customer_id=str(user.customer_id),
        is_superuser=user.is_superuser,
        must_change_password=bool(user.must_change_password),
        customer_name=cname,
        needs_customer_setup=_needs_customer_setup(cname),
    )


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t0 = time.perf_counter()
    pipeline_emit(
        log,
        component="api.auth",
        action="change_password",
        status="started",
        user_id=str(user.id),
    )
    if not verify_password(body.current_password, user.hashed_password):
        pipeline_emit(
            log,
            component="api.auth",
            action="change_password",
            status="denied",
            duration_ms=(time.perf_counter() - t0) * 1000,
            reason="current_password_mismatch",
            user_id=str(user.id),
        )
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.hashed_password = hash_password(body.new_password)
    user.must_change_password = False
    db.add(user)
    db.commit()
    pipeline_emit(
        log,
        component="api.auth",
        action="change_password",
        status="ok",
        duration_ms=(time.perf_counter() - t0) * 1000,
        user_id=str(user.id),
    )
    return None
