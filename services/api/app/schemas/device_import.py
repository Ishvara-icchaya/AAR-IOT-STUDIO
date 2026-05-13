import uuid

from pydantic import BaseModel, Field, field_validator, model_validator

_FW_CHANNELS = frozenset({"stable", "beta", "dev", "custom"})
_VERSION_STATUSES = frozenset({"active", "candidate", "pending", "breaking", "rolled_back"})


class DeviceImportRowIn(BaseModel):
    line: int = Field(ge=1, description="1-based source line for error reporting")
    name: str = Field(min_length=1, max_length=255)
    site_id: uuid.UUID
    description: str | None = None
    icon: str | None = Field(None, max_length=512)
    is_active: bool | None = None
    polling_enabled: bool | None = None
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
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        x = str(v).strip().lower()
        if x not in _FW_CHANNELS:
            raise ValueError(f"firmware_channel must be one of: {', '.join(sorted(_FW_CHANNELS))}")
        return x

    @field_validator("version_status", mode="before")
    @classmethod
    def _norm_version_status(cls, v: object) -> str | None:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        x = str(v).strip().lower().replace(" ", "_")
        if x not in _VERSION_STATUSES:
            raise ValueError(f"version_status must be one of: {', '.join(sorted(_VERSION_STATUSES))}")
        return x

    @model_validator(mode="after")
    def _threshold_order(self) -> "DeviceImportRowIn":
        late = self.late_threshold_seconds
        off = self.offline_threshold_seconds
        if late is not None and off is not None and off < late:
            raise ValueError("offline_threshold_seconds must be >= late_threshold_seconds")
        return self


class DeviceImportValidateRequest(BaseModel):
    rows: list[DeviceImportRowIn] = Field(default_factory=list)
    source_label: str | None = Field(None, max_length=255)


class DeviceImportRowError(BaseModel):
    line: int
    message: str


class DeviceImportValidateResponse(BaseModel):
    ok: bool
    row_errors: list[DeviceImportRowError] = Field(default_factory=list)
    validated_row_count: int = 0


class DeviceImportCommitRequest(BaseModel):
    rows: list[DeviceImportRowIn] = Field(default_factory=list)
    source_label: str | None = Field(None, max_length=255)


class DeviceImportCommitResponse(BaseModel):
    audit_id: uuid.UUID
    status: str
    """succeeded | partial | failed"""
    row_count: int
    success_count: int
    failure_count: int
    failures: list[DeviceImportRowError] = Field(default_factory=list)
