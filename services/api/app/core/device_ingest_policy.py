"""When new telemetry / raw payloads are accepted for a logical device."""

from __future__ import annotations

# Terminal device-level version statuses: no new raw ingest or scrubber processing.
_DEVICE_VERSION_STATUSES_BLOCKING_INGEST = frozenset({"deprecated", "rolled_back"})


def device_version_status_allows_ingest(version_status: str | None) -> bool:
    v = (version_status or "active").strip().lower().replace(" ", "_")
    return v not in _DEVICE_VERSION_STATUSES_BLOCKING_INGEST
