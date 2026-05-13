"""OTA status / campaign DTOs (Phases 4–5, 11)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

TerminalOtaTargetStatus = Literal["success", "failed", "rolled_back", "timeout", "cancelled"]

OtaProgressPhase = Literal["acknowledged", "downloading", "verifying", "installing", "rebooting"]


class OtaTargetStatusReport(BaseModel):
    """POST /ota/status — report terminal (or tracked) state for one campaign target."""

    target_id: uuid.UUID
    status: TerminalOtaTargetStatus
    command_id: str | None = Field(None, max_length=255)
    message: str | None = Field(None, max_length=2000)
    ota_external_ref: str | None = Field(None, max_length=255)
    payload: dict[str, Any] | None = None


class OtaTargetStatusResponse(BaseModel):
    target_id: uuid.UUID
    campaign_id: uuid.UUID
    device_id: uuid.UUID
    status: str


class OtaCampaignCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    site_id: uuid.UUID
    artifact_id: uuid.UUID | None = None
    target_firmware_version: str | None = Field(None, max_length=128)
    target_device_version_id: uuid.UUID | None = None
    rollout_strategy: str | None = None


class OtaCampaignUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    artifact_id: uuid.UUID | None = None
    target_firmware_version: str | None = Field(None, max_length=128)
    rollout_strategy: str | None = None
    target_device_version_id: uuid.UUID | None = None


class OtaCampaignTargetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campaign_id: uuid.UUID
    device_id: uuid.UUID
    resolved_device_id: uuid.UUID | None = None
    previous_device_version_id: uuid.UUID | None = None
    target_device_version_id: uuid.UUID | None = None
    current_firmware_version: str | None = None
    target_firmware_version: str | None = None
    status: str
    progress_pct: int
    failure_code: str | None = None
    failure_message: str | None = None
    last_status_at: datetime | None = None
    completed_at: datetime | None = None
    external_command_id: str | None = None
    claimed_by: str | None = None
    claimed_at: datetime | None = None
    lease_expires_at: datetime | None = None
    progress_phase: str | None = None
    reported_ota_external_ref: str | None = None


class OtaCampaignRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID | None = None
    name: str
    artifact_id: uuid.UUID | None = None
    target_firmware_version: str | None = None
    target_device_version_id: uuid.UUID | None = None
    status: str
    rollout_strategy: str | None = None
    approval_status: str
    created_by: uuid.UUID | None = None
    approved_by: uuid.UUID | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime


class OtaCampaignDetailRead(OtaCampaignRead):
    targets: list[OtaCampaignTargetRead] = Field(default_factory=list)
    simulator_poll_url: str | None = Field(
        default=None,
        description="Public HTTPS poll URL including secret token; only returned for users with ota.launch.",
    )
    simulator_status_url: str | None = Field(
        default=None,
        description="Public HTTPS POST URL (same token as poll) for terminal status; only for users with ota.launch.",
    )


class OtaCampaignListResponse(BaseModel):
    items: list[OtaCampaignRead]


class OtaAddTargetsRequest(BaseModel):
    device_ids: list[uuid.UUID] = Field(..., min_length=1)


class OtaAddTargetsResponse(BaseModel):
    added: list[OtaCampaignTargetRead]


class OtaEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campaign_id: uuid.UUID
    target_id: uuid.UUID | None = None
    event_type: str
    payload_json: dict[str, Any] | None = None
    created_at: datetime


class OtaEventListResponse(BaseModel):
    items: list[OtaEventRead]


class FirmwareArtifactCreate(BaseModel):
    site_id: uuid.UUID
    artifact_url: str = Field(..., min_length=1, max_length=8000)
    sha256: str = Field(..., min_length=1, max_length=128)
    signature: str | None = Field(None, max_length=16000)
    signature_algorithm: str | None = Field(None, max_length=64)
    size_bytes: int | None = Field(None, ge=0)
    release_notes: str | None = Field(None, max_length=32000)


class FirmwareArtifactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID | None = None
    artifact_url: str
    sha256: str
    signature: str | None = None
    signature_algorithm: str | None = None
    size_bytes: int | None = None
    release_notes: str | None = None
    created_at: datetime


class FirmwareArtifactListResponse(BaseModel):
    items: list[FirmwareArtifactRead]


class OtaExecutorArtifactBlock(BaseModel):
    url: str | None = None
    sha256: str | None = None
    signature: str | None = None
    signature_algorithm: str | None = None
    size_bytes: int | None = None
    release_notes: str | None = None


class OtaExecutorWorkItemRead(BaseModel):
    campaign_id: uuid.UUID
    target_id: uuid.UUID
    device_id: uuid.UUID
    device_display_id: str
    resolved_device_id: uuid.UUID | None = None
    target_firmware_version: str | None = None
    target_device_version_id: uuid.UUID | None = None
    artifact: OtaExecutorArtifactBlock = Field(default_factory=OtaExecutorArtifactBlock)


class OtaExecutorWorkListResponse(BaseModel):
    items: list[OtaExecutorWorkItemRead]
    next_cursor: str | None = None


class OtaSimulatorPublicPollResponse(BaseModel):
    """Public poll payload for upstream / lab OTA simulators (token-authenticated, no JWT)."""

    campaign_id: uuid.UUID
    campaign_name: str
    campaign_status: str
    hint: str = Field(
        ...,
        description="ok when items may be non-empty; campaign_not_releasing_work when not running",
    )
    items: list[OtaExecutorWorkItemRead] = Field(default_factory=list)
    next_cursor: str | None = None


class OtaTargetClaimRequest(BaseModel):
    executor_id: str = Field(..., min_length=1, max_length=255)
    lease_seconds: int = Field(300, ge=30, le=86400)


class OtaProgressReport(BaseModel):
    target_id: uuid.UUID
    phase: OtaProgressPhase
    message: str | None = Field(None, max_length=2000)
    payload: dict[str, Any] | None = None
