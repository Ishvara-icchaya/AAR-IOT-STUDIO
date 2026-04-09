"""Canonical alert categories — implementation guide §3.

All emitters must use only these values (``normalize_alert_category`` maps anything else to ``system``):

- ingest
- scrubber
- workflow
- publish
- dashboard
- monitoring
- ai
- device_health
- system
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
