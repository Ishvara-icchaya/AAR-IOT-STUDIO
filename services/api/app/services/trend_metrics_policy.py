"""Site + global allowlist for trend metric keys (GET /trends/window, map trend_context)."""

from __future__ import annotations

import re
import uuid
from typing import TYPE_CHECKING

from app.core.config import settings

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

_SPLIT_RE = re.compile(r"[,\s]+")


def _parse_allowlist_csv(raw: str) -> frozenset[str]:
    s = str(raw).strip()
    if not s:
        return frozenset()
    parts = [p.strip() for p in _SPLIT_RE.split(s) if p.strip()]
    return frozenset(parts)


def effective_metric_allowlist(db: "Session", *, site_id: uuid.UUID) -> frozenset[str] | None:
    """None = no restriction. Empty frozenset = deny all keys. Non-empty = allow-list only."""
    from app.models.site import Site

    site = db.get(Site, site_id)
    if site is not None and site.trend_metric_allowlist is not None:
        return _parse_allowlist_csv(site.trend_metric_allowlist)
    g = (settings.trend_metric_allowlist or "").strip()
    if not g:
        return None
    return _parse_allowlist_csv(g)


def filter_metric_keys_for_site(
    db: "Session",
    *,
    site_id: uuid.UUID,
    keys: list[str],
) -> list[str]:
    allow = effective_metric_allowlist(db, site_id=site_id)
    if allow is None:
        return list(keys)
    return [k for k in keys if k in allow]
