"""Metadata-first query helpers for ``data_objects`` (Phase B).

Catalog and selector endpoints must order by logical recency using latest observation
pointers, not ``created_at`` alone.
"""

from __future__ import annotations

from sqlalchemy import desc, func

from app.models.data_object import DataObject


def order_by_metadata_recency():
    """Prefer ``latest_seen_at`` (last detail sample), then ``updated_at``."""
    return desc(func.coalesce(DataObject.latest_seen_at, DataObject.updated_at))


def as_of_timestamp(row: DataObject):
    """Timestamp for “current” operational display: latest observation or metadata update."""
    return row.latest_seen_at or row.updated_at
