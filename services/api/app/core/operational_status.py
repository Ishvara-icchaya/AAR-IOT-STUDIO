"""Operational retirement (active / inactive / archived) — orthogonal to domain-specific lifecycle."""

OPERATIONAL_ACTIVE = "active"
OPERATIONAL_INACTIVE = "inactive"
OPERATIONAL_ARCHIVED = "archived"

OPERATIONAL_VALUES = frozenset({OPERATIONAL_ACTIVE, OPERATIONAL_INACTIVE, OPERATIONAL_ARCHIVED})


def is_operational_active(status: str | None) -> bool:
    return (status or OPERATIONAL_ACTIVE) == OPERATIONAL_ACTIVE


def is_selectable_for_new_links(status: str | None) -> bool:
    s = status or OPERATIONAL_ACTIVE
    return s == OPERATIONAL_ACTIVE
