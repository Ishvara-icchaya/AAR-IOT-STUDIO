import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.endpoint_activation import ACTIVATION_STATUS_DESCRIPTION

_FW_CHANNELS = frozenset({"stable", "beta", "dev", "custom"})


class DeviceWriteMetadata(BaseModel):
    """Optional v8 declared readiness / firmware fields (Phase 1 register + patch)."""

    expected_interval_seconds: int | None = Field(None, ge=5, le=86400)
    late_threshold_seconds: int | None = Field(None, ge=1, le=86400)
    offline_threshold_seconds: int | None = Field(None, ge=1, le=86400)
    firmware_version: str | None = Field(None, max_length=128)
    firmware_channel: str | None = Field(None, max_length=32)
    ota_supported: bool | None = None
    rollback_supported: bool | None = None
    device_version: str | None = Field(None, max_length=64)
    version_status: str | None = Field(None, max_length=32)

    @field_validator("firmware_channel", mode="before")
    @classmethod
    def _norm_fw_channel(cls, v: object) -> str | None:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        x = str(v).strip().lower()
        if x not in _FW_CHANNELS:
            raise ValueError(f"firmware_channel must be one of: {', '.join(sorted(_FW_CHANNELS))}")
        return x

    @field_validator("device_version", mode="before")
    @classmethod
    def _strip_device_version(cls, v: object) -> str | None:
        if v is None:
            return None
        if isinstance(v, str):
            t = v.strip()
            return t if t else None
        return str(v).strip() or None

    @field_validator("version_status", mode="before")
    @classmethod
    def _strip_version_status(cls, v: object) -> str | None:
        if v is None:
            return None
        if isinstance(v, str):
            t = v.strip()
            return t if t else None
        return str(v).strip() or None

    @field_validator("firmware_version", mode="before")
    @classmethod
    def _strip_fw_ver(cls, v: object) -> str | None:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return str(v).strip() if isinstance(v, str) else str(v)

    @model_validator(mode="after")
    def _threshold_order(self) -> "DeviceWriteMetadata":
        late = self.late_threshold_seconds
        off = self.offline_threshold_seconds
        if late is not None and off is not None and off < late:
            raise ValueError("offline_threshold_seconds must be >= late_threshold_seconds")
        return self


class DeviceCreate(DeviceWriteMetadata):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    icon: str | None = Field(None, max_length=512)
    site_id: uuid.UUID


class DeviceUpdate(DeviceWriteMetadata):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    icon: str | None = Field(None, max_length=512)
    site_id: uuid.UUID | None = None
    is_active: bool | None = None
    polling_enabled: bool | None = None


class DeviceEndpointNested(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    protocol: str
    config: dict[str, Any]
    polling_interval_seconds: int
    is_active: bool
    last_verified_at: datetime | None = None
    validation_status: str | None = None
    validation_detail: str | None = None
    activation_status: str = Field(default="configured", description=ACTIVATION_STATUS_DESCRIPTION)
    first_payload_at: datetime | None = None
    last_payload_at: datetime | None = None
    last_error: str | None = None


class DeviceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID
    name: str
    description: str | None
    icon: str | None
    is_active: bool
    polling_enabled: bool
    last_seen_at: datetime | None = None
    current_liveness_state: str = "waiting_for_first_payload"
    last_state_changed_at: datetime | None = None
    last_alerted_state: str | None = None
    expected_interval_seconds: int = 60
    late_threshold_seconds: int = 120
    offline_threshold_seconds: int = 300
    endpoint: DeviceEndpointNested | None = None
    # Operational lineage (ingest / activation / scrubber / dashboards) — not lifecycle operational_status.
    footprint_operational_status: str | None = None
    footprint_recommendation_code: str | None = None
    footprint_recommendation_message: str | None = None
    # v8 versioning / OTA readiness metadata (declared; list + detail).
    firmware_version: str | None = None
    firmware_channel: str = "stable"
    ota_supported: bool = False
    rollback_supported: bool = False
    device_version: str = "1"
    version_status: str = "active"


class DeviceListResponse(BaseModel):
    items: list[DeviceRead]


class DeviceDeleteFrozenDashboardRef(BaseModel):
    id: str
    name: str


class DeviceDeleteResponse(BaseModel):
    """Device delete always succeeds when not blocked; includes transparency when frozen dashboards still bound this device."""

    warning: str | None = None
    frozen_dashboard_count: int = 0
    frozen_dashboards: list[DeviceDeleteFrozenDashboardRef] = Field(default_factory=list)


class VersionLineageVersionItem(BaseModel):
    """One row in the immutable version lineage timeline (§13 triggers; KPI snapshots optional)."""

    id: str
    version_label: str
    is_current: bool
    recorded_at: datetime | None = None
    trigger_code: str
    superseded_by_label: str | None = None
    ota_external_ref: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    event_type: str | None = None
    source_type: str | None = None
    status: str | None = None
    target_device_version_id: str | None = None
    previous_device_version_id: str | None = None


class VersionLineageResponse(BaseModel):
    device_id: str
    versions: list[VersionLineageVersionItem]
    kpi_metric_keys: list[str]
    kpi_by_version: dict[str, dict[str, Any]]


class DeviceVersionRead(BaseModel):
    """Immutable device version row (Phase 3+) for lifecycle APIs."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    version_label: str
    status: str
    routing_lane: str
    firmware_version: str | None = None
    previous_device_version_id: uuid.UUID | None = None


class DeviceVersionSnapshotRead(BaseModel):
    """Full immutable snapshot row for Device Details / compare (Phase 8–9)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    version_label: str
    status: str
    routing_lane: str
    compatibility: str | None = None
    firmware_version: str | None = None
    hardware_version: str | None = None
    config_version: str | None = None
    endpoint_version: str | None = None
    scrubber_version: str | None = None
    schema_version: str | None = None
    manifest_hash: str | None = None
    firmware_channel: str
    version_source: str
    created_at: datetime
    activated_at: datetime | None = None
    previous_device_version_id: uuid.UUID | None = None


class DeviceVersionSnapshotListResponse(BaseModel):
    items: list[DeviceVersionSnapshotRead]


class VersionFieldDiffEntry(BaseModel):
    field: str
    baseline: str | None = None
    candidate: str | None = None
    changed: bool = False


class ImpactWorkflowRef(BaseModel):
    id: str
    name: str
    lifecycle_status: str
    is_published: bool
    site_id: str | None = None
    definition_version: int | None = None


class ImpactDashboardRef(BaseModel):
    id: str
    name: str
    status: str
    site_id: str | None = None


class DeviceVersionImpactNote(BaseModel):
    code: str
    message: str
    dashboard_count: int | None = None


class ImpactWidgetAttributeRow(BaseModel):
    """Per-widget attribute/metric references vs device field catalog (Phase 9)."""

    dashboard_id: str
    dashboard_name: str
    widget_id: str | None = None
    widget_type: str | None = None
    widget_title: str = ""
    attribute_ids: list[str] = Field(default_factory=list)
    missing_from_catalog: list[str] = Field(default_factory=list)
    review_recommended: bool = False


class DeviceVersionImpactResponse(BaseModel):
    device_id: str
    candidate_id: str
    baseline_id: str | None = None
    field_diff: list[VersionFieldDiffEntry]
    workflows: list[ImpactWorkflowRef]
    dashboards: list[ImpactDashboardRef]
    catalog_attribute_ids: list[str] = Field(default_factory=list)
    widget_attribute_impact: list[ImpactWidgetAttributeRow] = Field(default_factory=list)
    notes: list[DeviceVersionImpactNote]


class OtaTargetHistoryItem(BaseModel):
    target_id: str
    campaign_id: str
    campaign_name: str
    campaign_status: str
    target_status: str
    target_firmware_version: str | None = None
    completed_at: datetime | None = None


class DeviceOtaTargetHistoryResponse(BaseModel):
    items: list[OtaTargetHistoryItem]

