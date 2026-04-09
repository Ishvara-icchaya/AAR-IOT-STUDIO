"""Raw_data_objects lifecycle + verification status strings (Postgres + API)."""

from __future__ import annotations

# Ingest pipeline (SoT row progression)
INGEST_RECEIVED = "received"
INGEST_ARCHIVED = "archived"
INGEST_PUBLISHED_TO_KAFKA = "published_to_kafka"
INGEST_VERIFIED = "verified"
INGEST_FAILED = "failed"

# Verification checks (verify_status column)
VERIFY_NEVER = "never"
VERIFY_HEAD_OK = "head_ok"
VERIFY_HEAD_MISSING = "head_missing"
VERIFY_OK = "ok"
VERIFY_MISMATCH = "mismatch"
VERIFY_SIZE_MISMATCH = "size_mismatch"
VERIFY_NO_CHECKSUM = "no_checksum"
VERIFY_ERROR = "error"
