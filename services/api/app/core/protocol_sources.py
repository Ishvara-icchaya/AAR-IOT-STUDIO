"""
Canonical protocol / transport labels for raw ingest and workers.

Envelope `source` = transport channel; `protocol_id` = application protocol when known.
"""

from __future__ import annotations

import re

# Frozen canonical set (extend deliberately; prefer schema_version 2 for breaking changes).
CANONICAL_PROTOCOL_IDS: frozenset[str] = frozenset(
    {
        "mqtt",
        "rest",
        "coap",
        "websocket",
        "upload",
        "modbus",
    }
)

# Persisted on raw_data_objects.protocol_source (application or transport fallback).
TRANSPORT_UPLOAD = "upload"


def normalize_protocol_id(raw: str | None) -> str | None:
    """Normalize optional subscriber / application protocol id."""
    if raw is None:
        return None
    s = raw.strip().lower().replace("-", "_")
    if not s:
        return None
    if not re.match(r"^[a-z][a-z0-9_]{0,63}$", s):
        return None
    return s


def raw_row_protocol_source(protocol_id: str | None) -> str:
    """DB protocol_source: application protocol if set, else generic upload transport."""
    n = normalize_protocol_id(protocol_id)
    if n and n in CANONICAL_PROTOCOL_IDS:
        return n
    if n:
        return n
    return TRANSPORT_UPLOAD


def normalize_envelope_source(source: str) -> str:
    """Map legacy / alias values onto canonical transport `source` for the envelope."""
    s = (source or "").strip().lower().replace("-", "_")
    aliases = {
        "http": "rest",
        "https": "rest",
        "http_upload": "upload",
        "multipart": "upload",
    }
    s = aliases.get(s, s)
    if s in CANONICAL_PROTOCOL_IDS:
        return s
    return s if s else TRANSPORT_UPLOAD
