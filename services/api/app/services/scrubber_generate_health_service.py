"""LLM-assisted health mapping generation for Scrubber Studio."""

from __future__ import annotations

import json
import re
from typing import Any

from app.core.config import settings
from app.services.ai_health_service import bump_llm_failure_counter, call_ollama_chat


def _truncate(obj: Any, max_chars: int) -> str:
    try:
        s = json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        s = str(obj)
    if len(s) <= max_chars:
        return s
    return s[: max(0, max_chars - 24)] + "\n…[truncated]"


def _extract_json_object(text: str) -> dict[str, Any] | None:
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


SYSTEM = """You are a senior IoT data engineer. You output ONE JSON object only (no markdown).

The UI stores deterministic health as an ordered list: first matching rule wins; if none match, status is green.

Rule kinds:
- missing: field absent/null/empty
- match: regex on string form of value (when regex is feasible)
- numeric: compare numbers at a dotted path. Use pipe-delimited encoding (path may contain dots):
  - Comparison: num:PATH|OP|THRESH where OP is gt, gte, lt, lte, eq, ne (e.g. num:gumbo|gt|71)
  - Strict open interval (a < x < b): num:PATH|open|A|B
  - Inclusive band [A,B]: num:PATH|between|A|B

Also optionally fill llm_health_kpi when logic is fuzzy, multi-attribute NL, or cannot be expressed as simple rules:
- llm_health_kpi.enabled, kpi/health sub-objects with enabled, selectedPaths[], prompt strings.

Return shape:
{
  "health_mode": "rules" | "fixed",
  "health_rules": [ { "kind": "missing"|"match"|"numeric", "path": "...", "pattern": "", "numMode": "cmp"|"open"|"between", "numOp": "gt", "numLo": "0", "numHi": "", "status": "red|yellow|green", "code": "", "message": "" } ],
  "health_fixed": null | { "status", "code", "message" },
  "llm_health_kpi": null | { "enabled": true, "kpi": {...}, "health": {...} },
  "rationale": "short"
}

Put higher-severity rules first (e.g. red before yellow). For numeric thresholds on the same field, ensure ranges do not overlap incorrectly."""


def generate_health_mapping(
    *,
    prompt: str,
    mapping_draft: dict[str, Any],
    live_snapshot: dict[str, Any] | None,
    compiled_snapshot: dict[str, Any] | None,
) -> dict[str, Any]:
    cap = max(4000, int(getattr(settings, "ai_llm_max_prompt_chars", 12000)))
    parts = [
        "## Author request\n" + prompt.strip(),
        "## Current mapping draft (scrubber pipeline JSON)\n" + _truncate(mapping_draft, cap),
    ]
    if live_snapshot is not None:
        parts.append("## Live preview snapshot (browser — function-based may be placeholder)\n" + _truncate(live_snapshot, cap // 2))
    if compiled_snapshot is not None:
        parts.append("## Compiled preview snapshot (server — full Python transform)\n" + _truncate(compiled_snapshot, cap // 2))

    user_content = "\n\n".join(parts)
    if len(user_content) > cap + 8000:
        user_content = user_content[: cap + 8000 - 30] + "\n…[truncated]"

    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": user_content},
    ]
    timeout = float(getattr(settings, "ai_llm_timeout_seconds", 45.0) or 45.0)
    try:
        raw = call_ollama_chat(messages, timeout=timeout)
        parsed = _extract_json_object(raw)
        if not parsed:
            bump_llm_failure_counter()
            return {"error": "Could not parse model JSON"}
    except Exception as e:
        bump_llm_failure_counter()
        return {"error": str(e)[:2000]}

    mode = str(parsed.get("health_mode") or "rules").lower()
    out: dict[str, Any] = {
        "health_mode": "fixed" if mode == "fixed" else "rules",
        "health_rules": parsed.get("health_rules") if isinstance(parsed.get("health_rules"), list) else [],
        "health_fixed": parsed.get("health_fixed") if isinstance(parsed.get("health_fixed"), dict) else None,
        "llm_health_kpi": parsed.get("llm_health_kpi") if isinstance(parsed.get("llm_health_kpi"), dict) else None,
        "rationale": str(parsed.get("rationale") or "")[:4000] or None,
        "error": None,
    }
    return out
