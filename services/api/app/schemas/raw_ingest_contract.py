"""Canonical raw ingest envelope (HTTP + Kafka). Keep in sync with workers/app/raw_ingest_contract.py."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


RAW_INGEST_SCHEMA_VERSION: Literal["1"] = "1"


class RawIngestEnvelopeV1(BaseModel):
    """Wire format for optional Kafka publish and worker consumption (schema v1).

    Frozen: do not change field semantics without schema_version \"2\".
    Optional fields may be added; unknown keys are ignored by tolerant consumers.
    """

    model_config = ConfigDict(extra="allow")

    schema_version: Literal["1"] = Field(default="1")
    raw_object_id: UUID
    customer_id: UUID
    device_id: UUID
    endpoint_id: UUID = Field(
        ...,
        description="Mandatory v2 endpoint identity for downstream processing.",
    )
    storage_key: str
    content_type: str | None = None
    size_bytes: int = Field(ge=0)
    checksum_sha256: str | None = Field(
        default=None,
        description="Lowercase hex SHA-256 of object bytes in MinIO",
    )
    captured_at: datetime | None = None
    ingested_at: datetime
    source: str = Field(
        default="upload",
        description="Canonical transport: mqtt, rest, coap, websocket, upload, modbus, …",
    )
    protocol_id: str | None = Field(
        default=None,
        description="Application protocol for worker dispatch (e.g. modbus, mqtt)",
    )
    original_filename: str | None = None
    trace_id: str | None = Field(
        default=None,
        description="Correlates HTTP ingest → raw.ingest → downstream workers",
    )

    def to_kafka_json_bytes(self) -> bytes:
        return self.model_dump_json().encode("utf-8")


class RawIngestHttpResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    raw_object_id: UUID
    endpoint_id: UUID
    device_id: UUID
    customer_id: UUID
    storage_key: str
    content_type: str | None
    size_bytes: int
    checksum_sha256: str | None
    captured_at: datetime | None
    ingested_at: datetime
    ingest_status: str
    protocol_source: str | None
    trace_id: str | None = None
    kafka_published: bool
    kafka_error: str | None = None


class RawObjectVerifyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    raw_object_id: UUID
    device_id: UUID
    customer_id: UUID
    storage_key: str
    content_type: str | None
    size_bytes: int | None
    checksum_sha256: str | None
    captured_at: datetime | None
    ingested_at: datetime
    minio_exists: bool
    minio_size_bytes: int | None = None
    checksum_match: bool | None = Field(
        default=None,
        description="True if recomputed SHA-256 of object matches stored checksum (when checksum present)",
    )
    ingest_status: str | None = None
    verify_status: str | None = None
    verified_at: datetime | None = None
    verify_message: str | None = None
    is_latest_for_device: bool = Field(
        default=False,
        description="True when this raw row is the newest for its device_id "
        "(ingested_at DESC NULLS LAST, id DESC — same ordering as raw list head).",
    )


def build_envelope(
    *,
    raw_object_id: UUID,
    customer_id: UUID,
    device_id: UUID,
    endpoint_id: UUID,
    storage_key: str,
    content_type: str | None,
    size_bytes: int,
    checksum_sha256: str | None,
    captured_at: datetime | None,
    source: str,
    protocol_id: str | None,
    original_filename: str | None,
    trace_id: str | None = None,
) -> RawIngestEnvelopeV1:
    from app.core.protocol_sources import normalize_envelope_source

    return RawIngestEnvelopeV1(
        raw_object_id=raw_object_id,
        customer_id=customer_id,
        device_id=device_id,
        endpoint_id=endpoint_id,
        storage_key=storage_key,
        content_type=content_type,
        size_bytes=size_bytes,
        checksum_sha256=checksum_sha256,
        captured_at=captured_at,
        ingested_at=datetime.now(timezone.utc),
        source=normalize_envelope_source(source),
        protocol_id=protocol_id,
        original_filename=original_filename,
        trace_id=trace_id,
    )
