"""Tenant workspace inbox (messages + optional attachments).

Revision ID: 0039_workspace_messages
Revises: 0038_platform_admin_role_label
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0039_workspace_messages"
down_revision: Union[str, None] = "0038_platform_admin_role_label"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("attachment_filename", sa.String(length=255), nullable=True),
        sa.Column("attachment_mime", sa.String(length=128), nullable=True),
        sa.Column("attachment_data", sa.LargeBinary(), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_workspace_messages_recipient_created", "workspace_messages", ["recipient_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_workspace_messages_recipient_created", table_name="workspace_messages")
    op.drop_table("workspace_messages")
