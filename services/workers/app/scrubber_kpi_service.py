"""Build KPI JSON: display field subset + metric values (preview/worker)."""

from __future__ import annotations

from typing import Any

from app.scrubber_rule_eval import _get_path


def _coerce_float(val: Any) -> float | None:
    if val is None:
        return None
    if isinstance(val, bool):
        return float(int(val))
    if isinstance(val, (int, float)):
        return float(val)
    try:
        return float(str(val).strip())
    except (TypeError, ValueError):
        return None


def _legacy_kpi(template: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """Migrate old literals + fromPayload into displayFields object."""
    display: dict[str, Any] = {}
    lit = template.get("literals")
    if isinstance(lit, dict):
        for k, v in lit.items():
            display[str(k)] = v
    fp = template.get("fromPayload")
    if isinstance(fp, dict):
        for k, path in fp.items():
            if isinstance(path, str) and path.strip():
                v = _get_path(payload, path.strip())
                if v is not None:
                    display[str(k)] = v
    return {"displayFields": display, "metrics": {}}


def build_kpi_output(kpi_spec: Any, payload: dict[str, Any]) -> dict[str, Any]:
    """Return KPI object stored in data_object.kpi_json (nested displayFields + metrics)."""
    if kpi_spec is None:
        return {"displayFields": {}, "metrics": {}}
    if not isinstance(kpi_spec, dict):
        return {"displayFields": {}, "metrics": {}}

    # New schema
    if "displayFields" in kpi_spec or "metrics" in kpi_spec:
        display_paths = kpi_spec.get("displayFields")
        if not isinstance(display_paths, list):
            display_paths = []
        display_obj: dict[str, Any] = {}
        for path in display_paths:
            if not isinstance(path, str) or not path.strip():
                continue
            p = path.strip()
            display_obj[p] = _get_path(payload, p)

        metrics_out: dict[str, Any] = {}
        metrics_spec = kpi_spec.get("metrics")
        if isinstance(metrics_spec, dict):
            for field_key, meta in metrics_spec.items():
                if not isinstance(meta, dict):
                    continue
                if not bool(meta.get("track", True)):
                    continue
                path = str(meta.get("field") or field_key).strip()
                if not path:
                    continue
                raw_val = _get_path(payload, path)
                num = _coerce_float(raw_val)
                windows = meta.get("windows") if isinstance(meta.get("windows"), list) else ["1h", "24h"]
                metrics_out[str(field_key)] = {
                    "type": str(meta.get("type") or "numeric"),
                    "value": num,
                    "raw": raw_val,
                    "unit": meta.get("unit"),
                    "label": meta.get("label"),
                    "windows": [str(w) for w in windows],
                    "store_history": bool(meta.get("store_history", True)),
                }
        return {"displayFields": display_obj, "metrics": metrics_out}

    # Legacy literals/fromPayload only
    if "literals" in kpi_spec or "fromPayload" in kpi_spec:
        return _legacy_kpi(kpi_spec, payload)

    # Plain dict passthrough (older odd shapes)
    if not any(k in kpi_spec for k in ("literals", "fromPayload", "displayFields", "metrics")):
        return {"displayFields": {}, "metrics": {}, "extra": dict(kpi_spec)}

    return {"displayFields": {}, "metrics": {}}
