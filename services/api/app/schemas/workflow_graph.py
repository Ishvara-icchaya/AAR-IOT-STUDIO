from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.result_object_contract import ResultObjectListV1Response, ResultObjectV1

class WorkflowNodeWrite(BaseModel):
    id: uuid.UUID
    node_type: str
    node_name: str = Field(..., min_length=1, max_length=255)
    config_json: dict[str, Any] = Field(default_factory=dict)
    position_x: float = 0.0
    position_y: float = 0.0


class WorkflowEdgeWrite(BaseModel):
    id: uuid.UUID
    source_node_id: uuid.UUID
    target_node_id: uuid.UUID


class WorkflowCreate(BaseModel):
    site_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    nodes: list[WorkflowNodeWrite] = Field(default_factory=list)
    edges: list[WorkflowEdgeWrite] = Field(default_factory=list)


class WorkflowUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    site_id: uuid.UUID | None = None
    nodes: list[WorkflowNodeWrite] | None = None
    edges: list[WorkflowEdgeWrite] | None = None


class WorkflowNodeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workflow_id: uuid.UUID
    node_type: str
    node_name: str
    config_json: dict[str, Any]
    position_x: float
    position_y: float
    created_at: datetime
    updated_at: datetime


class WorkflowEdgeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workflow_id: uuid.UUID
    source_node_id: uuid.UUID
    target_node_id: uuid.UUID
    created_at: datetime


class WorkflowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID | None
    name: str
    description: str | None
    lifecycle_status: str
    version: int
    is_published: bool
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    nodes: list[WorkflowNodeRead] = Field(default_factory=list)
    edges: list[WorkflowEdgeRead] = Field(default_factory=list)


class WorkflowListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID | None
    name: str
    lifecycle_status: str
    version: int
    is_published: bool
    updated_at: datetime
    input_count: int = 0
    terminate_count: int = 0


class WorkflowListResponse(BaseModel):
    items: list[WorkflowListItem]


class WorkflowValidateResponse(BaseModel):
    valid: bool
    errors: list[str]


class WorkflowTestRequest(BaseModel):
    data_object_id: uuid.UUID | None = None
    sample_payload: dict[str, Any] | None = None


class ResultObjectPreview(BaseModel):
    result_object_name: str
    payload: dict[str, Any]
    terminate_node_id: str | None = None


class WorkflowTestResponse(BaseModel):
    workflow_id: uuid.UUID
    status: str
    node_outputs: dict[str, dict[str, Any]]
    result_objects: list[ResultObjectPreview]
    error: str | None = None


class WorkflowExecutionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workflow_id: uuid.UUID
    trigger_type: str
    input_data_object_id: uuid.UUID | None
    status: str
    started_at: datetime
    finished_at: datetime | None
    trace_id: str | None
    error_message: str | None


class WorkflowExecutionListResponse(BaseModel):
    items: list[WorkflowExecutionRead]


WorkflowResultObjectRead = ResultObjectV1
WorkflowResultListResponse = ResultObjectListV1Response


class DataObjectSourceItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    site_id: uuid.UUID
    name: str
    lifecycle_status: str
    updated_at: datetime


class DataObjectSourceListResponse(BaseModel):
    items: list[DataObjectSourceItem]


class WorkflowPreviewResponse(BaseModel):
    workflow: WorkflowRead
    validation_errors: list[str] = Field(default_factory=list)
