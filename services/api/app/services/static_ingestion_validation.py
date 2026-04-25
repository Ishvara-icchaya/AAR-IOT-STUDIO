"""Validate schedule_json and payload_json for static ingestions.

Payload objects may include string keys like ``$expr`` for values computed at schedule
time (evaluated by the static-ingestion worker / workflow runtime); values must remain
JSON-serializable.
"""

from __future__ import annotations

import json
from typing import Any

SCHEDULE_KINDS = frozenset({"hourly", "daily", "alternate_days", "weekly", "monthly", "cron"})


def _jsonable_value(v: Any, depth: int) -> bool:
    if depth > 48:
        return False
    if v is None or isinstance(v, (bool, int, float, str)):
        return True
    if isinstance(v, dict):
        if not all(isinstance(k, str) for k in v):
            return False
        return all(_jsonable_value(x, depth + 1) for x in v.values())
    if isinstance(v, list):
        return all(_jsonable_value(x, depth + 1) for x in v)
    return False


def validate_payload_semantics(obj: Any) -> list[str]:
    if not isinstance(obj, dict):
        return ["payload must be a JSON object with string keys"]
    if not _jsonable_value(obj, 0):
        return ["payload values must be JSON-serializable (object, array, string, number, boolean, or null)"]
    try:
        json.dumps(obj)
    except (TypeError, ValueError) as e:
        return [f"payload is not JSON-serializable: {e}"]
    return []


def validate_schedule_semantics(obj: Any) -> list[str]:
    errs: list[str] = []
    if not isinstance(obj, dict):
        return ["schedule_json must be an object"]
    kind = str(obj.get("kind") or "").strip().lower()
    if kind not in SCHEDULE_KINDS:
        return [
            "schedule_json.kind must be one of: hourly, daily, alternate_days, weekly, monthly, cron"
        ]

    def req_int(key: str, lo: int, hi: int, label: str) -> None:
        v = obj.get(key)
        if v is None:
            errs.append(f"schedule_json.{key} is required for {label}")
            return
        if not isinstance(v, int) or isinstance(v, bool) or v < lo or v > hi:
            errs.append(f"schedule_json.{key} must be an integer from {lo} to {hi}")

    if kind == "hourly":
        m = obj.get("minute")
        if m is not None and (not isinstance(m, int) or isinstance(m, bool) or m < 0 or m > 59):
            errs.append("schedule_json.minute must be 0–59 when set")
    elif kind == "daily":
        req_int("hour", 0, 23, "daily")
        req_int("minute", 0, 59, "daily")
    elif kind == "alternate_days":
        req_int("hour", 0, 23, "alternate_days")
        req_int("minute", 0, 59, "alternate_days")
    elif kind == "weekly":
        req_int("hour", 0, 23, "weekly")
        req_int("minute", 0, 59, "weekly")
        dow = obj.get("days_of_week")
        if dow is None:
            errs.append("schedule_json.days_of_week is required for weekly (0=Mon … 6=Sun)")
        elif not isinstance(dow, list) or not dow:
            errs.append("schedule_json.days_of_week must be a non-empty array")
        else:
            for i, d in enumerate(dow):
                if not isinstance(d, int) or isinstance(d, bool) or d < 0 or d > 6:
                    errs.append(f"schedule_json.days_of_week[{i}] must be 0–6")
    elif kind == "monthly":
        req_int("day_of_month", 1, 31, "monthly")
        req_int("hour", 0, 23, "monthly")
        req_int("minute", 0, 59, "monthly")
    elif kind == "cron":
        expr = obj.get("expression") or obj.get("cron")
        if not isinstance(expr, str) or not expr.strip():
            errs.append("schedule_json.expression (or cron) must be a non-empty string for cron kind")

    return errs
