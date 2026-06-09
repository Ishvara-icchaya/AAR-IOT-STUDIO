"""Mirror of API ``device_ingest_policy`` for worker ingest + scrubber (separate package tree)."""

from __future__ import annotations

_DEVICE_VERSION_STATUSES_BLOCKING_INGEST = frozenset({"deprecated", "rolled_back"})


def device_version_status_allows_ingest(version_status: object) -> bool:
    v = str(version_status or "active").strip().lower().replace(" ", "_")
    return v not in _DEVICE_VERSION_STATUSES_BLOCKING_INGEST
