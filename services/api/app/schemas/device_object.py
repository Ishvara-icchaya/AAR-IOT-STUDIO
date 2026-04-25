import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict


class DeviceObjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    customer_id: uuid.UUID
    mapping: dict[str, Any]


class DeviceObjectPatch(BaseModel):
    """Shallow merge; `scrubberStudio` dicts are merged one level deep."""

    mapping: dict[str, Any]


def merge_device_object_mapping(existing: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    m = dict(existing)
    for k, v in patch.items():
        if k == "scrubberStudio" and isinstance(v, dict) and isinstance(m.get("scrubberStudio"), dict):
            m["scrubberStudio"] = {**m["scrubberStudio"], **v}
        elif k == "fieldCatalog" and isinstance(v, dict) and isinstance(m.get("fieldCatalog"), dict):
            m["fieldCatalog"] = {**m["fieldCatalog"], **v}
        else:
            m[k] = v
    return m
