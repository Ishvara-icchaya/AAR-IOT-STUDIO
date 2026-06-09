import uuid

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
