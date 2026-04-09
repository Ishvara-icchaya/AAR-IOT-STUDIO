"""Canonical alert categories — keep in sync with services/api/app/core/alert_category.py.

Emitters must use only: ingest, scrubber, workflow, publish, dashboard, monitoring, ai,
device_health, system (unknown values map to system via normalize_alert_category).
"""

from __future__ import annotations

ALLOWED_ALERT_CATEGORIES: frozenset[str] = frozenset(
    {
        "ingest",
        "scrubber",
        "workflow",
        "publish",
        "dashboard",
        "monitoring",
        "ai",
        "device_health",
        "system",
    }
)


def normalize_alert_category(category: str | None) -> str:
    c = (category or "system").strip().lower()[:32]
    if c in ALLOWED_ALERT_CATEGORIES:
        return c
    return "system"
