"""Canonical alert severities: info | warning | critical | informational.

``informational`` is for DML / configuration audit rows shown in Alerts without an incident level
(see ``INFORMATIONAL_SEVERITY``); unacknowledged summaries treat it separately from operational counts.
"""

from __future__ import annotations

from typing import Literal

AlertSeverity = Literal["info", "warning", "critical", "informational"]

ALLOWED_SEVERITIES: tuple[str, ...] = ("info", "warning", "critical", "informational")

# Use for emit_alert when recording DML (device created, endpoint created, etc.).
INFORMATIONAL_SEVERITY: str = "informational"


def normalize_severity(raw: str | None) -> str:
    """Map legacy values to info | warning | critical | informational."""
    if not raw:
        return "info"
    x = str(raw).strip().lower()
    if x in ALLOWED_SEVERITIES:
        return x
    if x in ("fatal", "severe", "emergency", "high", "error", "red", "failed", "failure"):
        return "critical"
    if x in ("medium", "yellow", "warn", "degraded"):
        return "warning"
    if x in ("low", "green", "blue", "ok", "success", "debug", "notice"):
        return "info"
    return "warning"


def assert_canonical_severity(s: str) -> str:
    n = normalize_severity(s)
    return n
