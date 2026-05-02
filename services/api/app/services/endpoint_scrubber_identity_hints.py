"""Derive v2 identity path hints from device_objects.mapping.scrubber2.fieldSemantics."""

from __future__ import annotations

from typing import Any


def paths_from_scrubber2_model(model: dict[str, Any] | None) -> tuple[list[str], list[str]]:
    """Return (primary_device_key_paths, device_label_paths) from field semantics roles."""
    if not isinstance(model, dict):
        return [], []
    rows = model.get("fieldSemantics")
    if not isinstance(rows, list):
        return [], []
    pk: list[str] = []
    labels: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        path = str(row.get("path") or "").strip()
        if not path:
            continue
        roles = row.get("roles")
        if not isinstance(roles, list):
            continue
        rset = {str(x).strip() for x in roles if str(x).strip()}
        if "identity" in rset:
            pk.append(path)
        if "display" in rset:
            labels.append(path)
    return pk, labels


def paths_from_device_mapping(mapping: dict[str, Any] | None) -> tuple[list[str], list[str]]:
    if not isinstance(mapping, dict):
        return [], []
    s2 = mapping.get("scrubber2")
    if not isinstance(s2, dict):
        return [], []
    m = s2.get("model")
    return paths_from_scrubber2_model(m if isinstance(m, dict) else None)
