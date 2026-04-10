"""API contracts for referential integrity (409 conflicts, dependency lists)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import HTTPException, status
from pydantic import BaseModel, Field

EntityType = Literal[
    "workflow",
    "dashboard",
    "published_service",
    "workflow_execution",
    "raw_data_object",
    "device",
    "data_object",
    "site",
    "static_ingestion",
    "user_site",
    "device_endpoint",
    "device_object",
    "summary",
]


class DependencyItem(BaseModel):
    entity_type: EntityType
    entity_id: str
    label: str | None = None
    route_hint: str | None = Field(
        default=None,
        description="Frontend path fragment for deep-link (not full URL)",
    )


class ResourceInUseResponse(BaseModel):
    error: str = "resource_in_use"
    message: str
    dependencies: list[DependencyItem] = Field(default_factory=list)
    deactivate_url: str | None = None
    reactivate_url: str | None = None
    archive_url: str | None = None


class DependenciesListResponse(BaseModel):
    dependencies: list[DependencyItem] = Field(default_factory=list)


def raise_conflict_if_in_use(
    dependencies: list[DependencyItem],
    *,
    message: str,
    deactivate_url: str | None = None,
) -> None:
    if not dependencies:
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=conflict_body(
            message=message,
            dependencies=dependencies,
            deactivate_url=deactivate_url,
        ),
    )


def conflict_body(
    *,
    message: str,
    dependencies: list[DependencyItem],
    deactivate_url: str | None = None,
) -> dict[str, Any]:
    return ResourceInUseResponse(
        message=message,
        dependencies=dependencies,
        deactivate_url=deactivate_url,
    ).model_dump()
