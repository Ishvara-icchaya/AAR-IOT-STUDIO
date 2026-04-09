"""Central access policy tweaks after intent classification (testable)."""

from __future__ import annotations

from typing import Any


def apply_raw_debug_gate(
    intent_data: dict[str, Any],
    *,
    user_role: str,
    raw_debug_enabled: bool = True,
) -> dict[str, Any]:
    if intent_data.get("intent") == "raw_debug" and (
        user_role != "admin" or not raw_debug_enabled
    ):
        return {
            **intent_data,
            "intent": "unsupported",
            "needs_llm": False,
            "needs_raw_access": False,
        }
    return intent_data
