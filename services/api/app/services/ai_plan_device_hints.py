"""Resolve device name hints from natural language into plan filter device_ids (bounded, site-scoped)."""

from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.device import Device


def extract_device_name_hint(message: str) -> str | None:
    """Pick a device name after 'for …' at end of question, e.g. KPIs for LG-Berger."""
    t = (message or "").strip()
    if not t:
        return None
    m = re.search(r"\bfor\s+(?:the\s+)?(.+?)\s*(?:\?|\.|!)?\s*$", t, re.IGNORECASE | re.DOTALL)
    if m:
        name = m.group(1).strip().strip("'\"")
        return name if len(name) >= 2 else None
    m2 = re.search(r"\bfor\s+(?:the\s+)?([^?.!\n]+)", t, re.IGNORECASE)
    if m2:
        name = m2.group(1).strip().strip("'\"")
        return name if len(name) >= 2 else None
    return None


def resolve_device_ids_by_name_hint(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_ids: list[uuid.UUID],
    name_hint: str,
) -> list[uuid.UUID]:
    hint = name_hint.strip()
    if len(hint) < 2:
        return []

    base = select(Device.id).where(Device.customer_id == customer_id)
    if site_ids:
        base = base.where(Device.site_id.in_(site_ids))

    exact = list(
        db.scalars(
            base.where(func.lower(Device.name) == func.lower(hint)),
        ).all()
    )
    if len(exact) == 1:
        return exact
    if len(exact) > 1:
        return [exact[0]]

    esc = hint.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    partial = list(
        db.scalars(
            base.where(Device.name.ilike(f"%{esc}%", escape="\\")),
        ).all()
    )
    if len(partial) == 1:
        return partial
    if len(partial) > 1:
        partial.sort()
        return [partial[0]]
    return []


def apply_kpi_device_hint(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_ids: list[uuid.UUID],
    message: str,
    plan: dict[str, Any],
) -> dict[str, Any]:
    if str(plan.get("intent") or "") != "kpi_trend":
        return plan
    if plan.get("filters", {}).get("device_ids"):
        return plan
    hint = extract_device_name_hint(message)
    if not hint:
        return plan
    ids = resolve_device_ids_by_name_hint(db, customer_id=customer_id, site_ids=site_ids, name_hint=hint)
    if not ids:
        return plan
    out = {**plan}
    filters = dict(out.get("filters") or {})
    filters["device_ids"] = [str(x) for x in ids]
    out["filters"] = filters
    return out
