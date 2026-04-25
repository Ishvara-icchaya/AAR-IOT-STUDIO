"""Semantic field catalog → compact AI projection (generic; no dataset-specific heuristics)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from app.services.scrubber_rule_eval import _get_path

FIELD_ROLES = frozenset(
    {
        "metric",
        "identity",
        "health",
        "geo",
        "grouping",
        "display",
        "filter",
        "timestamp",
    }
)


def _serialize_leaf(v: Any, cap: int = 400) -> Any:
    if v is None:
        return None
    if isinstance(v, (bool, int, float)):
        return v
    if isinstance(v, str):
        s = v.strip()
        return s[:cap] + ("…" if len(s) > cap else "")
    try:
        s = json.dumps(v, default=str)
        return s[:cap] + ("…" if len(s) > cap else "")
    except Exception:
        s = str(v)
        return s[:cap] + ("…" if len(s) > cap else "")


def _field_key(path: str) -> str:
    p = (path or "").strip()
    if not p:
        return ""
    if "." in p:
        return p.rsplit(".", 1)[-1]
    return p


def _root_dict(payload: dict[str, Any], kpi_json: dict[str, Any], root: str) -> dict[str, Any]:
    r = (root or "payload").strip().lower()
    if r in ("kpi", "kpi_json"):
        return kpi_json if isinstance(kpi_json, dict) else {}
    return payload if isinstance(payload, dict) else {}


def parse_field_catalog(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    fields = raw.get("fields")
    if not isinstance(fields, list) or not fields:
        return None
    return raw


def validate_field_catalog(catalog: Any) -> tuple[list[str], list[str]]:
    """Return (errors, warnings) for admin PATCH; errors block save, warnings are logged only."""
    errors: list[str] = []
    warnings: list[str] = []
    if catalog is None:
        return errors, warnings
    if not isinstance(catalog, dict):
        return ["fieldCatalog must be an object"], warnings
    fields = catalog.get("fields")
    if fields is None:
        return errors, warnings
    if not isinstance(fields, list):
        return ["fieldCatalog.fields must be an array"], warnings
    has_timestamp = False
    has_identity_or_display = False
    for i, f in enumerate(fields):
        if not isinstance(f, dict):
            errors.append(f"fieldCatalog.fields[{i}] must be an object")
            continue
        path = f.get("path")
        if not isinstance(path, str) or not path.strip():
            errors.append(f"fieldCatalog.fields[{i}].path is required")
            continue
        if not re.match(r"^[A-Za-z0-9_.]+$", path.strip()):
            errors.append(f"fieldCatalog.fields[{i}].path has invalid characters")
        roles = f.get("roles")
        if not isinstance(roles, list) or not roles:
            errors.append(f"fieldCatalog.fields[{i}].roles must be a non-empty array")
            continue
        for r in roles:
            if str(r) not in FIELD_ROLES:
                errors.append(f"fieldCatalog.fields[{i}].roles contains invalid role {r!r}")
        if any(str(r) == "timestamp" for r in roles):
            has_timestamp = True
        if any(str(r) in ("identity", "display", "filter") for r in roles):
            has_identity_or_display = True
        if f.get("ai_exposed") is True:
            label = f.get("label")
            if not isinstance(label, str) or not label.strip():
                errors.append(f"fieldCatalog.fields[{i}].label required when ai_exposed is true")
        root = f.get("root")
        if root is not None and str(root).strip().lower() not in ("payload", "kpi", "kpi_json"):
            errors.append(f"fieldCatalog.fields[{i}].root must be payload or kpi")
    if fields and not has_timestamp:
        warnings.append("fieldCatalog: no field has role timestamp (recommended for AI time context)")
    if fields and not has_identity_or_display:
        warnings.append("fieldCatalog: no identity/display/filter fields (AI answers may be thin)")
    return errors, warnings


def build_ai_projection_document(
    *,
    catalog: dict[str, Any] | None,
    payload: dict[str, Any],
    kpi_json: dict[str, Any],
    object_type: str | None,
) -> dict[str, Any] | None:
    """Build role-bucket projection for persistence and Enterprise AI. Returns None if no catalog."""
    cat = parse_field_catalog(catalog)
    if not cat:
        return None
    fields = cat.get("fields")
    if not isinstance(fields, list):
        return None
    version = int(cat.get("version") or 0)
    buckets: dict[str, dict[str, Any]] = {r: {} for r in FIELD_ROLES}
    exposed_any = False
    for f in fields:
        if not isinstance(f, dict):
            continue
        if not f.get("ai_exposed"):
            continue
        path = str(f.get("path") or "").strip()
        if not path:
            continue
        root = str(f.get("root") or "payload").strip().lower()
        base = _root_dict(payload, kpi_json, root)
        raw_val = _get_path(base, path)
        if raw_val is None:
            continue
        key = _field_key(path) or path
        roles = f.get("roles")
        if not isinstance(roles, list):
            continue
        val = _serialize_leaf(raw_val)
        if val is None:
            continue
        exposed_any = True
        for role in roles:
            rs = str(role).strip()
            if rs not in FIELD_ROLES:
                continue
            b = buckets.setdefault(rs, {})
            if key in b:
                continue
            b[key] = val
    if not exposed_any:
        return None
    out: dict[str, Any] = {
        "_meta": {
            "catalog_version": version,
            "object_type": (object_type or "data_object").strip()[:200] or "data_object",
            "asof_ts": datetime.now(timezone.utc).isoformat(),
        },
    }
    for role, vals in buckets.items():
        if vals:
            out[role] = vals
    return out
