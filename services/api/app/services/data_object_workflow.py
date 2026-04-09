"""Queries for workflow / downstream consumers (published data_objects only)."""

from __future__ import annotations

from sqlalchemy import Select, select

from app.core.data_object_lifecycle import DATA_PUBLISHED
from app.models.data_object import DataObject


def select_published_data_objects() -> Select[tuple[DataObject]]:
    """Base query: only rows safe for workflow graph execution."""
    return select(DataObject).where(DataObject.lifecycle_status == DATA_PUBLISHED)
