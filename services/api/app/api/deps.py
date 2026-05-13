import uuid
from dataclasses import dataclass
from typing import Union

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.request_context import bind_customer_id
from app.core.security import safe_decode_token
from app.db.session import get_db
from app.models.user import User
from app.services.permission_service import user_is_customer_admin

security_bearer = HTTPBearer(auto_error=True)
security_bearer_optional = HTTPBearer(auto_error=False)


def _load_user_from_access_token(creds: HTTPAuthorizationCredentials, db: Session) -> User:
    payload = safe_decode_token(creds.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    try:
        uid = uuid.UUID(str(payload["sub"]))
    except ValueError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid subject") from e

    user = (
        db.execute(
            select(User)
            .options(joinedload(User.site_links), selectinload(User.customer))
            .where(User.id == uid)
        )
        .unique()
        .scalar_one_or_none()
    )
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Inactive or unknown user")
    if user.account_status == "disabled":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is disabled")
    bind_customer_id(str(user.customer_id))
    return user


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(security_bearer),
    db: Session = Depends(get_db),
) -> User:
    return _load_user_from_access_token(creds, db)


def require_admin(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Tenant customer admin (or platform superuser)."""
    if user.is_superuser:
        return user
    if user_is_customer_admin(db, user):
        return user
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator role required")


@dataclass(frozen=True)
class OtaWorkPollIntegration:
    customer_id: uuid.UUID


@dataclass(frozen=True)
class OtaWorkPollJwtUser:
    user: User


OtaWorkPollIdentity = Union[OtaWorkPollIntegration, OtaWorkPollJwtUser]


def get_ota_work_poll_identity(
    creds: HTTPAuthorizationCredentials | None = Depends(security_bearer_optional),
    db: Session = Depends(get_db),
) -> OtaWorkPollIdentity:
    """Bearer may be ``OTA_API_BEARER_TOKEN`` (integration) or a normal JWT (``ota.executor.read`` path)."""
    import secrets

    from app.core.config import settings

    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authorization required")
    raw = creds.credentials.strip()
    token = (settings.ota_api_bearer_token or "").strip()
    if token:
        try:
            if secrets.compare_digest(token, raw):
                if settings.ota_api_customer_id is None:
                    raise HTTPException(
                        status.HTTP_503_SERVICE_UNAVAILABLE,
                        "OTA_API_CUSTOMER_ID must be set when OTA_API_BEARER_TOKEN is configured",
                    )
                bind_customer_id(str(settings.ota_api_customer_id))
                return OtaWorkPollIntegration(settings.ota_api_customer_id)
        except ValueError:
            pass
    user = _load_user_from_access_token(creds, db)
    return OtaWorkPollJwtUser(user)


def get_ota_status_actor(
    creds: HTTPAuthorizationCredentials | None = Depends(security_bearer_optional),
    db: Session = Depends(get_db),
) -> User:
    """JWT (human/executor) or ``OTA_API_BEARER_TOKEN`` resolved to ``OTA_API_ACTOR_USER_ID``."""
    import secrets

    from app.core.config import settings

    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authorization required")
    raw = creds.credentials.strip()
    token = (settings.ota_api_bearer_token or "").strip()
    if token:
        try:
            if secrets.compare_digest(token, raw):
                if not settings.ota_api_customer_id:
                    raise HTTPException(
                        status.HTTP_503_SERVICE_UNAVAILABLE,
                        "OTA_API_CUSTOMER_ID must be set when OTA_API_BEARER_TOKEN is configured",
                    )
                if not settings.ota_api_actor_user_id:
                    raise HTTPException(
                        status.HTTP_503_SERVICE_UNAVAILABLE,
                        "OTA_API_ACTOR_USER_ID must be set for POST /ota/status with OTA_API_BEARER_TOKEN",
                    )
                actor = db.get(User, settings.ota_api_actor_user_id)
                if not actor or not actor.is_active or actor.customer_id != settings.ota_api_customer_id:
                    raise HTTPException(
                        status.HTTP_503_SERVICE_UNAVAILABLE,
                        "OTA_API_ACTOR_USER_ID must be an active user in OTA_API_CUSTOMER_ID",
                    )
                bind_customer_id(str(settings.ota_api_customer_id))
                return actor
        except ValueError:
            pass
    return _load_user_from_access_token(creds, db)
