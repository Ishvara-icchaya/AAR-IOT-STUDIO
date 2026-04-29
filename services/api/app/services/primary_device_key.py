"""Copy of worker primary_device_key helpers for API-side publish validation."""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any


def _get_path(payload: dict[str, Any], dotted: str) -> Any:
    cur: Any = payload
    for part in dotted.split("."):
        if not part:
            continue
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _canonical_scalar(value: Any) -> Any:
    if isinstance(value, str):
        s = value.strip()
        if s == "":
            return None
        return s
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        d = Decimal(str(value)).normalize()
        return format(d, "f")
    if value is None:
        return None
    if isinstance(value, Decimal):
        d = value.normalize()
        return format(d, "f")
    return str(value).strip() or None


def extract_primary_key_json(payload: dict[str, Any], key_fields: list[str]) -> dict[str, Any] | None:
    out: dict[str, Any] = {}
    for key in key_fields:
        path = str(key).strip()
        if not path:
            return None
        raw = _get_path(payload, path)
        c = _canonical_scalar(raw)
        if c is None:
            return None
        out[path] = c
    return out if out else None


def compute_primary_key_hash(primary_key_json: dict[str, Any]) -> str:
    canon = json.dumps(primary_key_json, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def build_device_label(payload: dict[str, Any], label_fields: list[str]) -> str | None:
    if not label_fields:
        return None
    parts: list[str] = []
    for path in label_fields:
        raw = _get_path(payload, str(path).strip())
        c = _canonical_scalar(raw)
        if c is None:
            continue
        parts.append(str(c))
    if not parts:
        return None
    return " | ".join(parts)[:512]
