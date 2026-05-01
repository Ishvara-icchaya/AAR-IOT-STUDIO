"""Scrubber transform from device_objects.mapping.scrubberStudio + raw bytes.

Kept in sync with services/workers/app/scrubber_engine.py (duplicate module).
"""

from __future__ import annotations

import ast
import builtins
import concurrent.futures
import copy
import datetime as dt
import json
import math
import random
import re
import statistics
from dataclasses import dataclass, field
from typing import Any

from app.services.scrubber_health_service import evaluate_health
from app.services.scrubber_kpi_service import build_kpi_output


@dataclass(frozen=True)
class ScrubberRunResult:
    object_name: str
    payload: dict[str, Any]
    kpi: dict[str, Any]
    health_status: str
    health_code: str
    health_message: str
    scrubber_version: str | None
    health_details: dict[str, Any] = field(default_factory=dict)


def _parse_raw_payload(raw: bytes, content_type: str | None, parse_as: str | None) -> dict[str, Any]:
    ct = (content_type or "").lower()
    mode = (parse_as or "auto").lower()
    if mode == "text":
        return {"_raw_text": raw.decode("utf-8", errors="replace")}
    if mode == "json":
        return json.loads(raw.decode("utf-8"))
    if mode == "auto":
        text_like = ct.startswith("text/") or "json" in ct or ct in ("application/xml",)
        if text_like or raw[:1] in (b"{", b"[", b'"'):
            try:
                return json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                pass
        return {"_raw_text": raw.decode("utf-8", errors="replace"), "_encoding": "utf-8-replace"}
    raise ValueError(f"unsupported parse_as: {parse_as}")


def _get_path(obj: Any, dotted: str) -> Any:
    cur: Any = obj
    for part in dotted.split("."):
        if part == "":
            continue
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def _delete_dotted_path(obj: dict[str, Any], dotted: str) -> None:
    parts = [p for p in dotted.split(".") if p]
    if not parts:
        return
    cur: Any = obj
    for part in parts[:-1]:
        if not isinstance(cur, dict) or part not in cur:
            return
        cur = cur[part]
    if isinstance(cur, dict):
        last = parts[-1]
        if last in cur:
            del cur[last]


def _flatten_one_level(payload: dict[str, Any], delimiter: str) -> dict[str, Any]:
    delim = delimiter if isinstance(delimiter, str) and delimiter else "_"
    out: dict[str, Any] = {}
    for k, v in list(payload.items()):
        if isinstance(v, dict) and v:
            for nk, nv in v.items():
                out[f"{k}{delim}{nk}"] = nv
        else:
            out[k] = v
    return out


def _flatten_complete(payload: dict[str, Any], delimiter: str, max_rounds: int = 64) -> dict[str, Any]:
    """Repeatedly flatten one level until no nested dict values remain (arrays untouched)."""
    p: dict[str, Any] = copy.deepcopy(payload)
    delim = delimiter if isinstance(delimiter, str) and delimiter else "_"
    for _ in range(max_rounds):
        nxt = _flatten_one_level(p, delim)
        if nxt == p:
            return nxt
        p = nxt
    return p


def _merge_from_payload_template(into: dict[str, Any], template: dict[str, Any], payload: dict[str, Any]) -> None:
    for k, path in template.items():
        if isinstance(path, str) and path.strip():
            val = _get_path(payload, path.strip())
            if val is not None:
                into[str(k)] = val


def _scalar_coerce(val: Any) -> Any:
    if val is None or isinstance(val, (bool, int, float, str)):
        return val
    if isinstance(val, (dict, list)):
        return json.dumps(val, sort_keys=True)
    return str(val)


def _apply_scalar_fields(payload: dict[str, Any], fields: Any) -> None:
    if not isinstance(fields, list):
        return
    for item in fields:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        if "literal" in item:
            payload[name] = _scalar_coerce(item.get("literal"))
            continue
        fp = item.get("fromPath")
        if isinstance(fp, str) and fp.strip():
            raw = _get_path(payload, fp.strip())
            payload[name] = _scalar_coerce(raw)


def _coerce_finite_number(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        n = float(v)
        return n if math.isfinite(n) else None
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            n = float(s)
        except ValueError:
            return None
        return n if math.isfinite(n) else None
    return None


def _normalize_timestamp_iso(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        n = float(v)
        if not math.isfinite(n):
            return None
        sec = n if abs(n) < 1e12 else n / 1000.0
        try:
            d = dt.datetime.fromtimestamp(sec, tz=dt.timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
        return d.isoformat().replace("+00:00", "Z")
    s = str(v).strip()
    if not s:
        return None
    if s.isdigit():
        try:
            n = float(s)
            sec = n if len(s) < 13 else n / 1000.0
            d = dt.datetime.fromtimestamp(sec, tz=dt.timezone.utc)
            return d.isoformat().replace("+00:00", "Z")
        except (OverflowError, OSError, ValueError):
            return None
    try:
        p = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        if p.tzinfo is None:
            p = p.replace(tzinfo=dt.timezone.utc)
        else:
            p = p.astimezone(dt.timezone.utc)
        return p.isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


def _apply_gps_mapping(payload: dict[str, Any], spec: Any) -> None:
    if not isinstance(spec, dict) or not bool(spec.get("enabled")):
        return
    out: dict[str, Any] = {}
    issues: list[str] = []

    def num_for(path_key: str) -> float | None:
        raw = spec.get(path_key)
        if not isinstance(raw, str) or not raw.strip():
            return None
        return _coerce_finite_number(_get_path(payload, raw.strip()))
    mode = "static" if str(spec.get("sourceMode") or "").lower() == "static" else "path"
    if mode == "static":
        lat = _coerce_finite_number(spec.get("staticLatitude"))
        lon = _coerce_finite_number(spec.get("staticLongitude"))
    else:
        lat = num_for("latitudePath")
        lon = num_for("longitudePath")
    alt = num_for("altitudePath")
    heading = num_for("headingPath")
    speed = num_for("speedPath")
    ts: str | None = None
    tsp = spec.get("timestampPath")
    if isinstance(tsp, str) and tsp.strip():
        ts = _normalize_timestamp_iso(_get_path(payload, tsp.strip()))

    if lat is not None:
        out["lat"] = lat
    if lon is not None:
        out["lon"] = lon
    if alt is not None:
        out["alt"] = alt
    if heading is not None:
        out["heading"] = heading
    if speed is not None:
        out["speed"] = speed
    if ts is not None:
        out["timestamp"] = ts

    if lat is None or lat < -90 or lat > 90:
        issues.append("latitude invalid (range -90..90)")
    if lon is None or lon < -180 or lon > 180:
        issues.append("longitude invalid (range -180..180)")
    out["map_eligible"] = len(issues) == 0
    if issues:
        out["validation"] = issues
    payload["gps"] = out


def _assert_scalar_dict(out: Any) -> dict[str, Any]:
    if not isinstance(out, dict):
        raise ValueError("functionBased must return dict")
    result: dict[str, Any] = {}
    for k, v in out.items():
        if not isinstance(k, str) or not k.strip():
            raise ValueError("functionBased return keys must be non-empty strings")
        if isinstance(v, (dict, list, tuple, set)):
            raise ValueError(f"functionBased field '{k}' must be scalar")
        if v is not None and not isinstance(v, (bool, int, float, str)):
            raise ValueError(f"functionBased field '{k}' must be scalar")
        result[k] = v
    return result


def _run_with_timeout(fn: Any, timeout_ms: int) -> Any:
    """Run ``fn()`` with a wall-clock timeout.

    Uses a worker thread so this works under FastAPI/AnyIO thread pools (``signal``/``SIGALRM`` only works on
    the main interpreter thread).
    """
    if timeout_ms <= 0:
        timeout_ms = 200
    timeout_s = min(timeout_ms, 2000) / 1000.0
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(fn)
        try:
            return future.result(timeout=timeout_s)
        except concurrent.futures.TimeoutError as e:
            raise TimeoutError("functionBased timed out") from e


_FUNCTION_BASED_BUILTIN_NAMES: frozenset[str] = frozenset(
    {
        "abs",
        "all",
        "any",
        "bin",
        "bool",
        "chr",
        "dict",
        "divmod",
        "enumerate",
        "filter",
        "float",
        "format",
        "frozenset",
        "hasattr",
        "hash",
        "hex",
        "int",
        "isinstance",
        "issubclass",
        "iter",
        "len",
        "list",
        "map",
        "max",
        "min",
        "next",
        "oct",
        "ord",
        "pow",
        "range",
        "repr",
        "reversed",
        "round",
        "set",
        "slice",
        "sorted",
        "str",
        "sum",
        "tuple",
        "zip",
    }
)


def _function_based_globals_dict() -> dict[str, Any]:
    """Restricted ``__builtins__`` plus date/string helpers (no imports in user code)."""
    bltin: dict[str, Any] = {}
    for name in _FUNCTION_BASED_BUILTIN_NAMES:
        if hasattr(builtins, name):
            bltin[name] = getattr(builtins, name)
    return {
        "__builtins__": bltin,
        "datetime": dt.datetime,
        "date": dt.date,
        "time": dt.time,
        "timedelta": dt.timedelta,
        "timezone": dt.timezone,
        "re": re,
        "random": random,
    }


def _exec_function_based(payload: dict[str, Any], spec: Any) -> None:
    if not isinstance(spec, dict):
        return
    if not bool(spec.get("enabled", True)):
        return
    code = spec.get("code")
    if not isinstance(code, str) or not code.strip():
        return

    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as e:
        raise ValueError(f"functionBased syntax error: {e.msg}") from e
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise ValueError("functionBased imports are not allowed")

    helpers = {
        "lower": lambda x: str(x).lower(),
        "upper": lambda x: str(x).upper(),
        "strip": lambda x: str(x).strip(),
        "replace": lambda x, a, b: str(x).replace(str(a), str(b)),
        "split": lambda x, sep=None: str(x).split(sep),
        "join": lambda sep, parts: str(sep).join(str(p) for p in parts),
        "now_iso": lambda: dt.datetime.utcnow().isoformat(),
        "parse_iso": lambda s: dt.datetime.fromisoformat(str(s)),
        "to_epoch": lambda d: int(d.timestamp()) if hasattr(d, "timestamp") else int(d),
        "format_date": lambda d, fmt="%Y-%m-%dT%H:%M:%S": d.strftime(fmt) if hasattr(d, "strftime") else str(d),
        "abs": abs,
        "round": round,
        "min": min,
        "max": max,
        "sum": sum,
        "pow": pow,
        "sqrt": math.sqrt,
        "log": math.log,
        "mean": statistics.mean,
        "median": statistics.median,
        "stdev": statistics.stdev,
        "randint": random.randint,
        "random_float": random.random,
    }
    globals_dict = _function_based_globals_dict()
    globals_dict.update(helpers)
    locals_dict: dict[str, Any] = {}

    exec(compile(tree, "<functionBased>", "exec"), globals_dict, locals_dict)
    fn = locals_dict.get("transform") or globals_dict.get("transform")
    if not callable(fn):
        raise ValueError("functionBased must define callable transform(payload)")

    timeout_ms = spec.get("timeoutMs")
    timeout_val = int(timeout_ms) if isinstance(timeout_ms, int) else 200

    out = _run_with_timeout(lambda: fn(payload), timeout_val)
    merged = _assert_scalar_dict(out)
    payload.update(merged)
    payload["_scrubber_function_based"] = {
        "applied": True,
        "output_field_keys": sorted(merged.keys()),
    }


def _apply_transform_extensions(payload: dict[str, Any], active: dict[str, Any]) -> dict[str, Any]:
    """Shape payload after selectPath: drop → flatten → attributes → scalar fields → functionBased → gps."""
    p = copy.deepcopy(payload)
    if not isinstance(p, dict):
        p = {"value": p}

    drops = active.get("dropPaths")
    if isinstance(drops, list):
        for d in drops:
            if isinstance(d, str) and d.strip():
                _delete_dotted_path(p, d.strip())

    flatten = active.get("flatten")
    if isinstance(flatten, dict) and flatten.get("enabled"):
        delim = flatten.get("delimiter") if isinstance(flatten.get("delimiter"), str) else "_"
        p = _flatten_complete(p, delim)

    add_attrs = active.get("addAttributes")
    if isinstance(add_attrs, dict):
        lit = add_attrs.get("literals")
        if isinstance(lit, dict):
            for k, v in lit.items():
                p[str(k)] = copy.deepcopy(v)
        fp = add_attrs.get("fromPayload")
        if isinstance(fp, dict):
            _merge_from_payload_template(p, fp, p)

    _apply_scalar_fields(p, active.get("scalarFields"))
    _exec_function_based(p, active.get("functionBased"))
    _apply_gps_mapping(p, active.get("gpsMapping"))

    return p


def _eval_kpi(template: Any, payload: dict[str, Any]) -> dict[str, Any]:
    return build_kpi_output(template, payload)


def _health_numeric_value(payload: dict[str, Any], path: str) -> float | None:
    v = _get_path(payload, path)
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
    """True if pipe-delimited num: rule matches (path|mode|...)."""
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


def _eval_health(rules: Any, payload: dict[str, Any]) -> tuple[str, str, str, dict[str, Any]]:
    """Returns (status, code, message, health_details)."""
    return evaluate_health(rules, payload)


def _merge_health_onto_payload(
    payload: dict[str, Any],
    display: dict[str, Any],
    h_status: str,
    h_code: str,
    h_msg: str,
    h_details: dict[str, Any] | None = None,
) -> None:
    if not display.get("enabled"):
        return
    sk = str(display.get("statusKey") or "health_status")
    ck = str(display.get("codeKey") or "health_code")
    mk = str(display.get("messageKey") or "health_message")
    dk = str(display.get("detailsKey") or "health_details")
    payload[sk] = h_status
    payload[ck] = h_code
    payload[mk] = h_msg
    if h_details is not None and dk:
        payload[dk] = h_details


def _extract_json_object_from_llm(text: str) -> dict[str, Any] | None:
    t = text.strip()
    if not t:
        return None
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
    if fence:
        chunk = fence.group(1).strip()
        try:
            out = json.loads(chunk)
            return out if isinstance(out, dict) else None
        except json.JSONDecodeError:
            pass
    start = t.find("{")
    end = t.rfind("}")
    if start >= 0 and end > start:
        try:
            out = json.loads(t[start : end + 1])
            return out if isinstance(out, dict) else None
        except json.JSONDecodeError:
            pass
    return None


def _truncate_json_for_llm(payload: dict[str, Any], max_chars: int) -> str:
    s = json.dumps(payload, ensure_ascii=False, default=str)
    if len(s) <= max_chars:
        return s
    return s[: max(0, max_chars - 24)] + "\n…[truncated]"


def _apply_llm_health_kpi_overlay(
    active: dict[str, Any],
    payload: dict[str, Any],
    kpi: dict[str, Any],
    h_status: str,
    h_code: str,
    h_msg: str,
) -> tuple[dict[str, Any], str, str, str]:
    spec = active.get("llmHealthKpi")
    if not isinstance(spec, dict) or not spec.get("enabled"):
        return kpi, h_status, h_code, h_msg

    from app.core.config import settings
    from app.services.ai_health_service import bump_llm_failure_counter, call_ollama_chat

    kpi_spec = spec.get("kpi") if isinstance(spec.get("kpi"), dict) else {}
    health_spec = spec.get("health") if isinstance(spec.get("health"), dict) else {}
    kpi_on = bool(kpi_spec.get("enabled"))
    health_on = bool(health_spec.get("enabled"))
    if not kpi_on and not health_on:
        return kpi, h_status, h_code, h_msg

    kpi_paths = [str(x).strip() for x in (kpi_spec.get("selectedPaths") or []) if isinstance(x, str) and str(x).strip()]
    health_paths = [str(x).strip() for x in (health_spec.get("selectedPaths") or []) if isinstance(x, str) and str(x).strip()]
    kpi_prompt = str(kpi_spec.get("prompt") or "").strip()
    health_prompt = str(health_spec.get("prompt") or "").strip()

    hd0 = active.get("healthDisplay") if isinstance(active.get("healthDisplay"), dict) else {}
    sk = str(hd0.get("statusKey") or "health_status")
    ck = str(hd0.get("codeKey") or "health_code")
    mk = str(hd0.get("messageKey") or "health_message")

    max_body = max(2000, int(getattr(settings, "ai_llm_max_prompt_chars", 12000)))
    body_json = _truncate_json_for_llm(payload, max_body)

    chunks: list[str] = [
        "The JSON below is the fully evaluated scrubber result payload (after transforms and deterministic KPI/health). "
        "Treat it as the only source of truth.",
    ]
    if kpi_on:
        chunks.append(
            f"KPI (enabled): derive or refine KPI object keys for these paths: {kpi_paths!r}.\n"
            f"Author instructions:\n{kpi_prompt or '(none)'}"
        )
    if health_on:
        chunks.append(
            f"Health (enabled): derive metric values for these field names: {health_paths!r} "
            f"(map to status/code/message semantics as appropriate).\n"
            f"Author instructions:\n{health_prompt or '(none)'}"
        )
    chunks.append(
        'Return one JSON object only (no markdown): {"kpi": {...}, "health": {...}}. '
        'Omit a key if that part is disabled. Use selected path strings as keys in "kpi". '
        'Use selected metric names as keys in "health".'
    )
    chunks.append(f"Payload:\n{body_json}")
    user_content = "\n\n".join(chunks)
    cap = max_body + 6000
    if len(user_content) > cap:
        user_content = user_content[: cap - 20] + "\n…[truncated]"

    messages: list[dict[str, str]] = [
        {"role": "system", "content": "You reply with valid JSON only. No explanation."},
        {"role": "user", "content": user_content},
    ]
    timeout = float(getattr(settings, "ai_llm_timeout_seconds", 45.0) or 45.0)
    try:
        raw = call_ollama_chat(messages, timeout=timeout)
        parsed = _extract_json_object_from_llm(raw)
        if not parsed:
            raise ValueError("llm_json_parse_failed")
    except Exception:
        bump_llm_failure_counter()
        return kpi, h_status, h_code, h_msg

    out_kpi = copy.deepcopy(kpi)
    out_hs, out_hc, out_hm = h_status, h_code, h_msg

    if kpi_on and isinstance(parsed.get("kpi"), dict):
        lk = parsed["kpi"]
        for p in kpi_paths:
            if p in lk:
                out_kpi[p] = lk[p]

    if health_on and isinstance(parsed.get("health"), dict):
        lh = parsed["health"]
        for p in health_paths:
            if p not in lh:
                continue
            val = lh[p]
            if p == sk or p == "health_status":
                s = str(val).lower()
                out_hs = s if s in ("green", "yellow", "red") else "yellow"
            elif p == ck or p == "health_code":
                out_hc = str(val)
            elif p == mk or p == "health_message":
                out_hm = str(val)

    return out_kpi, out_hs, out_hc, out_hm


def apply_llm_health_kpi_overlay_public(
    active: dict[str, Any],
    payload: dict[str, Any],
    kpi: dict[str, Any],
    h_status: str,
    h_code: str,
    h_msg: str,
) -> tuple[dict[str, Any], str, str, str]:
    """Run LLM overlay on supplied payload/kpi/health (used by test endpoint)."""
    pl: dict[str, Any] = copy.deepcopy(payload) if isinstance(payload, dict) else {}
    kp: dict[str, Any] = copy.deepcopy(kpi) if isinstance(kpi, dict) else {}
    return _apply_llm_health_kpi_overlay(active, pl, kp, h_status, h_code, h_msg)


def run_scrubber(
    *,
    raw_bytes: bytes,
    content_type: str | None,
    scrubber_studio: dict[str, Any] | None,
) -> ScrubberRunResult:
    """Apply scrubberStudio draft (or published snapshot when present)."""
    ss = scrubber_studio if isinstance(scrubber_studio, dict) else {}
    published = bool(ss.get("published"))
    draft = ss.get("draft") if isinstance(ss.get("draft"), dict) else {}
    published_body = ss.get("publishedBody") if isinstance(ss.get("publishedBody"), dict) else {}
    active = published_body if published and published_body else draft

    parse_as = active.get("parseAs") if isinstance(active.get("parseAs"), str) else None
    try:
        payload = _parse_raw_payload(raw_bytes, content_type, parse_as)
    except (json.JSONDecodeError, ValueError) as e:
        raise ValueError(f"raw parse failed: {e}") from e

    select_path = active.get("selectPath")
    if isinstance(select_path, str) and select_path.strip():
        inner = _get_path(payload, select_path.strip())
        if isinstance(inner, dict):
            payload = inner
        elif inner is not None:
            payload = {"value": inner}
        else:
            payload = {"_error": "selectPath not found", "_path": select_path}

    if not isinstance(payload, dict):
        payload = {"value": payload}

    has_extensions = any(
        k in active
        for k in ("dropPaths", "flatten", "addAttributes", "scalarFields", "functionBased", "gpsMapping")
    )
    if has_extensions:
        payload = _apply_transform_extensions(payload, active)

    object_name = str(active.get("objectName") or ss.get("objectName") or "Data object")[:255]
    kpi = _eval_kpi(active.get("kpi"), payload)
    h_status, h_code, h_msg, h_details = _eval_health(active.get("health"), payload)
    if h_status not in ("green", "yellow", "red"):
        h_status = "yellow"

    hd = active.get("healthDisplay")
    if isinstance(hd, dict):
        _merge_health_onto_payload(payload, hd, h_status, h_code, h_msg, h_details)

    version = ss.get("version")
    scrubber_version = str(version) if version is not None else None

    return ScrubberRunResult(
        object_name=object_name,
        payload=payload,
        kpi=kpi,
        health_status=h_status,
        health_code=h_code,
        health_message=h_msg,
        scrubber_version=scrubber_version,
        health_details=h_details if isinstance(h_details, dict) else {},
    )
