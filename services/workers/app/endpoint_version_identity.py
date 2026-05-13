"""Pre-scrubber endpoint version identity stage (Redis + LDS ``system_json``); see docs/ENDPOINT_VERSION_IDENTITY.md."""

from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)


def _enabled() -> bool:
    v = os.environ.get("ENDPOINT_VERSION_IDENTITY_ENABLED", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def process_raw_version_identity(
    *,
    raw_bytes: bytes,
    content_type: str | None,
    endpoint_id: str | None,
    device_id: str,
    customer_id: str,
    site_id: str,
    raw_object_id: str,
    trace_id: str | None,
) -> None:
    """Runs after raw read, before scrubber / v2 resolution. No-op unless ``ENDPOINT_VERSION_IDENTITY_ENABLED``."""
    if not _enabled() or not endpoint_id:
        return
    log.debug(
        "endpoint_version_identity stub endpoint_id=%s raw_object_id=%s trace_id=%s",
        endpoint_id,
        raw_object_id,
        trace_id,
    )
