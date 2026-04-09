"""Health evaluation: direct map, rule-based (with precedence), and legacy scrubber rules."""

from __future__ import annotations

import re
from typing import Any

from app.services.scrubber_rule_eval import eval_rule_condition
from app.services.scrubber_rule_eval import _get_path as _path


def _health_numeric_value(payload: dict[str, Any], path: str) -> float | None:
    v = _path(payload, path)
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        try:
            return float(str(v).strip())
        except ValueError:
            return None


def _eval_health_num_when(when: str, payload: dict[str, Any]) -> bool:
    if not when.startswith("num:"):
        return False
    rest = when[len("num:") :].strip()
    parts = [p for p in rest.split("|") if p != ""]
    if len(parts) < 3:
        return False
    path = parts[0]
    n = _health_numeric_value(payload, path)
    if n is None:
        return False
    mode = parts[1].lower()
    try:
        if mode == "open" and len(parts) >= 4:
            lo, hi = float(parts[2]), float(parts[3])
            return lo < n < hi
        if mode == "between" and len(parts) >= 4:
            lo, hi = float(parts[2]), float(parts[3])
            return lo <= n <= hi
        if mode in ("gt", "gte", "lt", "lte", "eq", "ne") and len(parts) >= 3:
            rhs = float(parts[2])
            if mode == "gt":
                return n > rhs
            if mode == "gte":
                return n >= rhs
            if mode == "lt":
                return n < rhs
            if mode == "lte":
                return n <= rhs
            if mode == "eq":
                return n == rhs
            if mode == "ne":
                return n != rhs
    except (TypeError, ValueError):
        return False
    return False


def _norm_status(s: str) -> str:
    x = (s or "").lower().strip()
    return x if x in ("green", "yellow", "red") else "yellow"


SEVERITY_RANK = {"red": 3, "yellow": 2, "green": 1}


def _eval_health_legacy_list(rules: list[Any], payload: dict[str, Any]) -> tuple[str, str, str]:
    """First-match legacy list rules (when/missing/match/num)."""
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        when = rule.get("when")
        if isinstance(when, str) and when.startswith("missing:"):
            path = when[len("missing:") :].strip()
            if _path(payload, path) in (None, "", []):
                return (
                    _norm_status(str(rule.get("status") or "yellow")),
                    str(rule.get("code") or "missing"),
                    str(rule.get("message") or f"Missing {path}"),
                )
        if isinstance(when, str) and when.startswith("match:"):
            rest = when[len("match:") :].strip()
            m = re.match(r"(\S+)\s+(.+)", rest)
            if m:
                path, pattern = m.group(1), m.group(2)
                val = _path(payload, path)
                if val is not None and re.search(pattern, str(val)):
                    return (
                        _norm_status(str(rule.get("status") or "red")),
                        str(rule.get("code") or "match"),
                        str(rule.get("message") or "Pattern matched"),
                    )
        if isinstance(when, str) and when.startswith("num:"):
            if _eval_health_num_when(when, payload):
                return (
                    _norm_status(str(rule.get("status") or "yellow")),
                    str(rule.get("code") or "numeric"),
                    str(rule.get("message") or "Numeric rule matched"),
                )
    return "green", "ok", "All rules passed"


def _health_map_mode(spec: dict[str, Any], payload: dict[str, Any]) -> tuple[str, str, str]:
    source = str(spec.get("source_field") or "").strip()
    mapping = spec.get("mapping") if isinstance(spec.get("mapping"), dict) else {}
    msg_from = str(spec.get("message_from") or "").strip()
    raw = _path(payload, source) if source else None
    key = str(raw) if raw is not None else ""
    mapped = mapping.get(key)
    if mapped is None and raw is not None:
        mapped = mapping.get(raw)
    st = _norm_status(str(mapped or "yellow"))
    msg = ""
    if msg_from:
        mv = _path(payload, msg_from)
        if mv is not None:
            msg = str(mv)
    code = str(spec.get("default_code") or "mapped")
    return st, code, msg


def _health_rules_mode(spec: dict[str, Any], payload: dict[str, Any]) -> tuple[str, str, str]:
    default_status = _norm_status(str(spec.get("default_status") or "green"))
    rules = spec.get("rules") if isinstance(spec.get("rules"), list) else []
    matches: list[tuple[int, int, str, str, str]] = []
    for r in rules:
        if not isinstance(r, dict):
            continue
        cond = str(r.get("condition") or "").strip()
        if not cond:
            continue
        try:
            if not eval_rule_condition(cond, payload):
                continue
        except Exception:
            continue
        st = _norm_status(str(r.get("status") or "yellow"))
        sev = SEVERITY_RANK.get(st, 1)
        try:
            pr = int(r.get("priority") or 0)
        except (TypeError, ValueError):
            pr = 0
        code = str(r.get("code") or "")
        msg = str(r.get("message") or "")
        matches.append((sev, pr, st, code, msg))
    if not matches:
        return default_status, "default", "No rule matched"
    matches.sort(key=lambda x: (-x[0], -x[1]))
    _, _, st, code, msg = matches[0]
    return st, code or "rule", msg


def evaluate_health(health_spec: Any, payload: dict[str, Any]) -> tuple[str, str, str]:
    """Return normalized (status, code, message)."""
    if health_spec is None:
        return "green", "ok", ""
    if isinstance(health_spec, list):
        return _eval_health_legacy_list(health_spec, payload)
    if not isinstance(health_spec, dict):
        return "green", "ok", ""
    mode = str(health_spec.get("mode") or "").lower()
    if mode == "map":
        return _health_map_mode(health_spec, payload)
    if mode == "rules":
        return _health_rules_mode(health_spec, payload)
    rules = health_spec.get("rules")
    if isinstance(rules, list) and rules and isinstance(rules[0], dict) and "condition" in rules[0]:
        return _health_rules_mode({**health_spec, "mode": "rules"}, payload)
    if "status" in health_spec:
        st = _norm_status(str(health_spec.get("status") or "green"))
        return st, str(health_spec.get("code") or "ok"), str(health_spec.get("message") or "")
    return "green", "ok", ""
