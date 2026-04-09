"""Canonical `device_endpoints.activation_status` values (single source of truth)."""

from __future__ import annotations

# Persisted on device_endpoints.activation_status; keep workers/API/UI in sync.
ACTIVATION_STATUS_VALUES: tuple[str, ...] = (
    "configured",
    "waiting_for_first_payload",
    "active",
    "inactive",
    "error",
)

ACTIVATION_STATUS_SET: frozenset[str] = frozenset(ACTIVATION_STATUS_VALUES)

ACTIVATION_STATUS_DESCRIPTION = (
    "Allowed values: configured | waiting_for_first_payload | active | inactive | error"
)


def is_valid_activation_status(value: str) -> bool:
    return value.strip() in ACTIVATION_STATUS_SET
