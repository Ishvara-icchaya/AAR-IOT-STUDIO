import uuid
from typing import TYPE_CHECKING

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.rbac import SiteUserRole, TenantUserRole
    from app.models.user_site import UserSite


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    """Superuser may manage all users/sites for the customer."""
    role: Mapped[str] = mapped_column(String(32), default="operator", nullable=False)
    """platform_admin (is_superuser) | admin (tenant UI legacy) | operator — site scope via bindings."""
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    operational_status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    account_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="active"
    )
    """invited | active | disabled"""
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invited_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    customer: Mapped["Customer"] = relationship(back_populates="users")
    site_links: Mapped[list["UserSite"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    site_role_bindings: Mapped[list["SiteUserRole"]] = relationship(
        "SiteUserRole",
        foreign_keys="SiteUserRole.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    tenant_role_bindings: Mapped[list["TenantUserRole"]] = relationship(
        "TenantUserRole",
        foreign_keys="TenantUserRole.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
    )
