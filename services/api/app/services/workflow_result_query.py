"""Metadata-first helpers for ``workflow_result_objects`` (Phase C)."""

from __future__ import annotations

from sqlalchemy import desc, func

from app.models.workflow_result_object import WorkflowResultObject


def order_by_metadata_recency():
    """Prefer ``latest_seen_at`` (last detail sample), then ``created_at``."""
    return desc(func.coalesce(WorkflowResultObject.latest_seen_at, WorkflowResultObject.created_at))


def as_of_timestamp(row: WorkflowResultObject):
    """Operational “current” time for result object rows."""
    return row.latest_seen_at or row.created_at
