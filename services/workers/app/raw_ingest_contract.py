"""
Canonical raw ingest envelope v1 — keep fields aligned with
services/api/app/schemas/raw_ingest_contract.py (RawIngestEnvelopeV1).
"""

from __future__ import annotations

import uuid
from typing import Any


class RawIngestEnvelopeError(ValueError):
    pass


def parse_raw_ingest_envelope_v1(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate Kafka JSON body; returns the same dict for subscribers.

    Optional keys (ignored by validation): trace_id, and any forward-compatible extras.
    """
    if payload.get("schema_version") != "1":
        raise RawIngestEnvelopeError("unsupported schema_version")
    required = (
        "raw_object_id",
        "customer_id",
        "device_id",
        "endpoint_id",
        "storage_key",
        "size_bytes",
        "ingested_at",
    )
    for k in required:
        if k not in payload:
            raise RawIngestEnvelopeError(f"missing field: {k}")
    try:
        uuid.UUID(str(payload["raw_object_id"]))
        uuid.UUID(str(payload["customer_id"]))
        uuid.UUID(str(payload["device_id"]))
        uuid.UUID(str(payload["endpoint_id"]))
    except ValueError as e:
        raise RawIngestEnvelopeError("invalid uuid in envelope") from e
    if not isinstance(payload.get("size_bytes"), int) or payload["size_bytes"] < 0:
        raise RawIngestEnvelopeError("size_bytes must be a non-negative int")
    sk = payload.get("storage_key")
    if not isinstance(sk, str) or not sk.strip():
        raise RawIngestEnvelopeError("storage_key must be a non-empty string")
    return payload


def parse_raw_ingest_envelope_bytes(raw: bytes) -> dict[str, Any]:
    import json

    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise RawIngestEnvelopeError("invalid json") from e
    if not isinstance(data, dict):
        raise RawIngestEnvelopeError("envelope must be a JSON object")
    return parse_raw_ingest_envelope_v1(data)
