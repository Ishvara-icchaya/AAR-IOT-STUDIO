"""Canonical health → color + blink_mode for dashboard widgets (server-derived)."""

from __future__ import annotations

from typing import Any


def derive_blink_mode(
    *,
    health_status: str | None,
    health_blink: bool | None = None,
    health_severity: int | None = None,
    offline: bool | None = None,
) -> str:
    """
    Returns one of: none | slow | fast
    Matches spec §6 / §17 (GREEN none, YELLOW slow, RED fast, offline slow).
    """
    if offline:
        return "slow"
    s = (health_status or "").strip().lower()
    if s == "red":
        return "fast"
    if s == "yellow":
        return "slow"
    if s == "green":
        return "none"
    if health_blink is True:
        if health_severity is not None and health_severity >= 3:
            return "fast"
        return "slow"
    if health_severity is not None and health_severity >= 3:
        return "fast"
    if health_severity is not None and health_severity >= 1:
        return "slow"
    return "none"


def extract_health_fields(record: dict[str, Any]) -> dict[str, Any]:
    """Pull normalized health keys from a flat payload dict."""
    return {
        "health_status": record.get("health_status") or record.get("_health_status"),
        "health_blink": record.get("health_blink"),
        "health_severity": record.get("health_severity"),
        "offline": record.get("offline") or record.get("device_offline"),
    }
