"""Deterministic primary-device identity extraction + hash for v2 resolution."""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation
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

"""Deterministic primary device key extraction and hashing (mirrors services/api/app/core/primary_device_key.py)."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _get_by_dot_path(payload: dict[str, Any], path: str) -> Any:
    cur: Any = payload
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _normalize_scalar(value: Any, *, lowercase_strings: bool) -> str:
    if value is None:
        raise ValueError("primary key field resolved to null")
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)
    s = str(value).strip()
    if s == "":
        raise ValueError("primary key field is empty string")
    if lowercase_strings:
        s = s.lower()
    return s


def build_primary_key_json(
    *,
    primary_device_key_fields: list[str],
    payload: dict[str, Any],
    lowercase_primary_keys: bool,
) -> dict[str, str]:
    out: dict[str, str] = {}
    for path in primary_device_key_fields:
        path = path.strip()
        if not path:
            raise ValueError("empty primary_device_key field path")
        raw = _get_by_dot_path(payload, path)
        out[path] = _normalize_scalar(raw, lowercase_strings=lowercase_primary_keys)
    return out


def primary_key_hash_from_json(primary_key_json: dict[str, str], *, field_order: list[str]) -> str:
    ordered: dict[str, str] = {}
    for k in field_order:
        if k not in primary_key_json:
            raise ValueError(f"missing primary key field in json: {k}")
        ordered[k] = primary_key_json[k]
    canonical = json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def compute_primary_key_hash(
    *,
    primary_device_key_fields: list[str],
    payload: dict[str, Any],
    lowercase_primary_keys: bool,
) -> tuple[dict[str, str], str]:
    pk = build_primary_key_json(
        primary_device_key_fields=primary_device_key_fields,
        payload=payload,
        lowercase_primary_keys=lowercase_primary_keys,
    )
    h = primary_key_hash_from_json(pk, field_order=list(primary_device_key_fields))
    return pk, h


def build_device_label(
    *,
    payload: dict[str, Any],
    device_label_fields: list[str],
    lowercase_primary_keys: bool,
) -> str | None:
    parts: list[str] = []
    for path in device_label_fields:
        if not isinstance(path, str) or not path.strip():
            continue
        try:
            raw = _get_by_dot_path(payload, path.strip())
            parts.append(_normalize_scalar(raw, lowercase_strings=lowercase_primary_keys))
        except ValueError:
            continue
    if not parts:
        return None
    return " · ".join(parts)[:512]
