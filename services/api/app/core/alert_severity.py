"""Canonical alert severities: info | warning | critical."""

from __future__ import annotations

from typing import Literal

AlertSeverity = Literal["info", "warning", "critical"]

ALLOWED_SEVERITIES: tuple[str, ...] = ("info", "warning", "critical")


def normalize_severity(raw: str | None) -> str:
    """Map legacy values to info | warning | critical."""
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
