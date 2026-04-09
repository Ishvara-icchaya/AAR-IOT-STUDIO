import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


class PlatformPort(Base, TimestampMixin):
    __tablename__ = "platform_ports"
    __table_args__ = (UniqueConstraint("customer_id", "service_name", name="uq_platform_ports_customer_service"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
    )

    service_name: Mapped[str] = mapped_column(String(64), nullable=False)
    protocol: Mapped[str] = mapped_column(String(16), nullable=False)
    host: Mapped[str] = mapped_column(String(128), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    customer = relationship("Customer", backref="platform_ports")


class PlatformPortSettings(Base, TimestampMixin):
    __tablename__ = "platform_port_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    default_rest_publish_host: Mapped[str | None] = mapped_column(String(128), nullable=True)
    default_rest_publish_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    default_mqtt_publish_host: Mapped[str | None] = mapped_column(String(128), nullable=True)
    default_mqtt_publish_port: Mapped[int | None] = mapped_column(Integer, nullable=True)

    mqtt_ingest_broker_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="internal")
    mqtt_ingest_external_broker_host: Mapped[str | None] = mapped_column(String(128), nullable=True)
    mqtt_ingest_external_broker_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mqtt_ingest_subscribe_topic: Mapped[str | None] = mapped_column(String(512), nullable=True)
    mqtt_ingest_qos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    allow_external_access: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    restrict_to_localhost: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    enable_tls: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    customer = relationship("Customer", backref="platform_port_settings_row")
