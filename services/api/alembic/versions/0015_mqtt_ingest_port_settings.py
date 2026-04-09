"""MQTT ingest defaults on platform_port_settings (tenant UI)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0015_mqtt_ingest_ports"
down_revision = "0014_llm_ports_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "platform_port_settings",
        sa.Column("mqtt_ingest_broker_mode", sa.String(length=16), nullable=False, server_default="internal"),
    )
    op.add_column(
        "platform_port_settings",
        sa.Column("mqtt_ingest_external_broker_host", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "platform_port_settings",
        sa.Column("mqtt_ingest_external_broker_port", sa.Integer(), nullable=True),
    )
    op.add_column(
        "platform_port_settings",
        sa.Column("mqtt_ingest_subscribe_topic", sa.String(length=512), nullable=True),
    )
    op.add_column(
        "platform_port_settings",
        sa.Column("mqtt_ingest_qos", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("platform_port_settings", "mqtt_ingest_qos")
    op.drop_column("platform_port_settings", "mqtt_ingest_subscribe_topic")
    op.drop_column("platform_port_settings", "mqtt_ingest_external_broker_port")
    op.drop_column("platform_port_settings", "mqtt_ingest_external_broker_host")
    op.drop_column("platform_port_settings", "mqtt_ingest_broker_mode")
