"""Health evaluation: map, simple rules, thresholds (with health_details); legacy list."""

from __future__ import annotations

import re
from typing import Any

from app.scrubber_rule_eval import eval_rule_condition
from app.scrubber_rule_eval import _get_path as _path


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

TH_BAND_RANK = {"critical": 3, "warning": 2, "normal": 1, "unknown": 0}

TH_TO_DISPLAY = {"critical": "red", "warning": "yellow", "normal": "green", "unknown": "yellow"}


def _eval_health_legacy_list(rules: list[Any], payload: dict[str, Any]) -> tuple[str, str, str, dict[str, Any]]:
    """First-match legacy list rules (when/missing/match/num)."""
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        when = rule.get("when")
        if isinstance(when, str) and when.startswith("missing:"):
            path = when[len("missing:") :].strip()
            if _path(payload, path) in (None, "", []):
                st = _norm_status(str(rule.get("status") or "yellow"))
                code = str(rule.get("code") or "missing")
                msg = str(rule.get("message") or f"Missing {path}")
                return st, code, msg, {"mode": "legacy", "matched": "missing", "path": path}
        if isinstance(when, str) and when.startswith("match:"):
            rest = when[len("match:") :].strip()
            m = re.match(r"(\S+)\s+(.+)", rest)
            if m:
                path, pattern = m.group(1), m.group(2)
                val = _path(payload, path)
                if val is not None and re.search(pattern, str(val)):
                    st = _norm_status(str(rule.get("status") or "red"))
                    return (
                        st,
                        str(rule.get("code") or "match"),
                        str(rule.get("message") or "Pattern matched"),
                        {"mode": "legacy", "matched": "match", "path": path},
                    )
        if isinstance(when, str) and when.startswith("num:"):
            if _eval_health_num_when(when, payload):
                st = _norm_status(str(rule.get("status") or "yellow"))
                return (
                    st,
                    str(rule.get("code") or "numeric"),
                    str(rule.get("message") or "Numeric rule matched"),
                    {"mode": "legacy", "matched": "num"},
                )
    return "green", "ok", "All rules passed", {"mode": "legacy", "matched": None}


def _health_map_mode(spec: dict[str, Any], payload: dict[str, Any]) -> tuple[str, str, str, dict[str, Any]]:
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
    details: dict[str, Any] = {
        "mode": "map",
        "source_field": source,
        "raw_value": raw if isinstance(raw, (str, int, float, bool)) else (str(raw) if raw is not None else None),
        "mapped_status": st,
    }
    if msg_from:
        details["message_from_field"] = msg_from
    return st, code, msg, details


def _health_rules_mode(spec: dict[str, Any], payload: dict[str, Any]) -> tuple[str, str, str, dict[str, Any]]:
    default_status = _norm_status(str(spec.get("default_status") or "green"))
    rules = spec.get("rules") if isinstance(spec.get("rules"), list) else []
    matches: list[tuple[int, int, str, str, str, str]] = []
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
        name = str(r.get("name") or "")
        matches.append((sev, pr, st, code, msg, name))
    if not matches:
        return default_status, "default", "No rule matched", {"mode": "simple_rules", "matched": None}
    matches.sort(key=lambda x: (-x[0], -x[1]))
    _, _, st, code, msg, name = matches[0]
    return st, code or "rule", msg, {
        "mode": "simple_rules",
        "matched": {"name": name, "code": code, "message": msg, "status": st},
    }


def _matches_band(val: float, band: dict[str, Any]) -> bool:
    if not band:
        return False
    ok = True
    if "min" in band:
        ok = ok and val >= float(band["min"])
    if "max" in band:
        ok = ok and val <= float(band["max"])
    if "min_exclusive" in band:
        ok = ok and val > float(band["min_exclusive"])
    if "max_exclusive" in band:
        ok = ok and val < float(band["max_exclusive"])
    return ok


def _band_for_field(
    field_key: str,
    normal: dict[str, Any],
    warning: dict[str, Any],
    critical: dict[str, Any],
    payload: dict[str, Any],
) -> tuple[str, float | None]:
    """Return (band_name, numeric_value) or ('unknown', None)."""
    spec_crit = critical.get(field_key) if isinstance(critical.get(field_key), dict) else None
    spec_warn = warning.get(field_key) if isinstance(warning.get(field_key), dict) else None
    spec_norm = normal.get(field_key) if isinstance(normal.get(field_key), dict) else None
    val = _health_numeric_value(payload, field_key)
    if val is None:
        return "unknown", None
    if spec_crit and _matches_band(val, spec_crit):
        return "critical", val
    if spec_warn and _matches_band(val, spec_warn):
        return "warning", val
    if spec_norm and _matches_band(val, spec_norm):
        return "normal", val
    return "unknown", val


def _health_thresholds_mode(spec: dict[str, Any], payload: dict[str, Any]) -> tuple[str, str, str, dict[str, Any]]:
    definition = spec.get("definition")
    if not isinstance(definition, dict):
        return "yellow", "thresholds_invalid", "Missing or invalid thresholds definition", {"mode": "thresholds", "error": "no_definition"}
    ref_name = str(definition.get("reference_name") or "thresholds")
    normal = definition.get("normal") if isinstance(definition.get("normal"), dict) else {}
    warning = definition.get("warning") if isinstance(definition.get("warning"), dict) else {}
    critical = definition.get("critical") if isinstance(definition.get("critical"), dict) else {}

    keys: set[str] = set()
    for d in (normal, warning, critical):
        keys |= {k for k, v in d.items() if isinstance(v, dict)}

    if not keys:
        return (
            "green",
            "thresholds:empty",
            "No threshold fields defined",
            {"mode": "thresholds", "reference_name": ref_name, "overall_severity": "normal", "fields": []},
        )

    field_rows: list[dict[str, Any]] = []
    worst_rank = 0
    for fk in sorted(keys):
        band, val = _band_for_field(fk, normal, warning, critical, payload)
        worst_rank = max(worst_rank, TH_BAND_RANK.get(band, 0))
        field_rows.append(
            {
                "path": fk,
                "value": val,
                "band": band,
                "display_severity": TH_TO_DISPLAY.get(band, "yellow"),
            }
        )

    overall = {3: "critical", 2: "warning", 1: "normal", 0: "unknown"}.get(worst_rank, "unknown")
    display_status = TH_TO_DISPLAY.get(overall, "yellow")
    st = _norm_status(display_status)

    worst_labels = [r["path"] for r in field_rows if r["band"] == overall and overall != "normal"]
    if overall == "normal" and field_rows:
        msg = f"All sampled fields within normal bands ({ref_name})"
    elif overall == "unknown":
        msg = f"One or more fields did not match any band ({ref_name})"
    else:
        msg = f"{overall}: {', '.join(worst_labels[:8])}" + ("…" if len(worst_labels) > 8 else "")

    code = f"thresholds:{ref_name}:{overall}"
    details: dict[str, Any] = {
        "mode": "thresholds",
        "reference_name": ref_name,
        "overall_severity": overall,
        "fields": field_rows,
    }
    return st, code, msg, details


def evaluate_health(health_spec: Any, payload: dict[str, Any]) -> tuple[str, str, str, dict[str, Any]]:
    """Return normalized (status, code, message, health_details)."""
    if health_spec is None:
        return "green", "ok", "", {"mode": "none"}
    if isinstance(health_spec, list):
        return _eval_health_legacy_list(health_spec, payload)
    if not isinstance(health_spec, dict):
        return "green", "ok", "", {"mode": "none"}
    mode = str(health_spec.get("mode") or "").lower()
    if mode == "map":
        return _health_map_mode(health_spec, payload)
    if mode == "rules":
        return _health_rules_mode(health_spec, payload)
    if mode == "thresholds":
        return _health_thresholds_mode(health_spec, payload)
    rules = health_spec.get("rules")
    if isinstance(rules, list) and rules and isinstance(rules[0], dict) and "condition" in rules[0]:
        return _health_rules_mode({**health_spec, "mode": "rules"}, payload)
    if "status" in health_spec:
        st = _norm_status(str(health_spec.get("status") or "green"))
        return (
            st,
            str(health_spec.get("code") or "ok"),
            str(health_spec.get("message") or ""),
            {"mode": "static", "status": st},
        )
    return "green", "ok", "", {"mode": "none"}
