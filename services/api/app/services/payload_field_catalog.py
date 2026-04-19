"""Derive backend-provided field metadata from JSON payloads (Phase E)."""

from __future__ import annotations

from typing import Any

_MAX_ENTRIES = 500


def _type_name(val: Any) -> str:
    if val is None:
        return "null"
    if isinstance(val, bool):
        return "boolean"
    if isinstance(val, int) and not isinstance(val, bool):
        return "integer"
    if isinstance(val, float):
        return "number"
    if isinstance(val, str):
        return "string"
    if isinstance(val, list):
        return "array"
    if isinstance(val, dict):
        return "object"
    return "unknown"


def _sample_trim(val: Any, depth: int = 0) -> Any:
    if depth > 4:
        return "…"
    if isinstance(val, dict):
        out: dict[str, Any] = {}
        for i, (k, v) in enumerate(val.items()):
            if i >= 8:
                out["…"] = f"+{len(val) - 8} keys"
                break
            out[str(k)] = _sample_trim(v, depth + 1)
        return out
    if isinstance(val, list):
        if len(val) == 0:
            return []
        first = val[0]
        return [_sample_trim(first, depth + 1), f"… len={len(val)}" if len(val) > 1 else ""]
    if isinstance(val, str) and len(val) > 120:
        return val[:117] + "…"
    return val


def build_payload_field_entries(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Flatten nested dict keys into dotted paths with type + sample (for authoring UIs)."""
    if not isinstance(payload, dict):
        return []

    out: list[dict[str, Any]] = []
    stack: list[tuple[dict[str, Any], str, str | None]] = [(payload, "", None)]

    while stack and len(out) < _MAX_ENTRIES:
        obj, prefix, section = stack.pop()
        for k, v in obj.items():
            if len(out) >= _MAX_ENTRIES:
                break
            ks = str(k)
            path = f"{prefix}.{ks}" if prefix else ks
            sec = section if section is not None else ks
            if isinstance(v, dict):
                if v:
                    stack.append((v, path, sec))
                else:
                    out.append(
                        {
                            "path": path,
                            "type": "object",
                            "sample": {},
                            "section": sec,
                            "source": "payload",
                        }
                    )
            elif isinstance(v, list):
                out.append(
                    {
                        "path": path,
                        "type": "array",
                        "sample": _sample_trim(v),
                        "section": sec,
                        "source": "payload",
                    }
                )
            else:
                out.append(
                    {
                        "path": path,
                        "type": _type_name(v),
                        "sample": v,
                        "section": sec,
                        "source": "payload",
                    }
                )

    out.sort(key=lambda x: x["path"])
    return out
