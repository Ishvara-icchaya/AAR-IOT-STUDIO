"""Per-request context (trace + tenant scope) for structured logs."""

from __future__ import annotations

import contextvars
from typing import Any

trace_id_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar("aar_trace_id", default=None)
customer_id_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar("aar_customer_id", default=None)
site_id_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar("aar_site_id", default=None)
device_id_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar("aar_device_id", default=None)


def set_trace_id(trace_id: str | None) -> None:
    trace_id_ctx.set(trace_id)


def bind_customer_id(customer_id: str | None) -> None:
    customer_id_ctx.set(customer_id)


def bind_site_id(site_id: str | None) -> None:
    site_id_ctx.set(site_id)


def bind_device_id(device_id: str | None) -> None:
    device_id_ctx.set(device_id)


def clear() -> None:
    trace_id_ctx.set(None)
    customer_id_ctx.set(None)
    site_id_ctx.set(None)
    device_id_ctx.set(None)


def snapshot() -> dict[str, Any]:
    return {
        "trace_id": trace_id_ctx.get(),
        "customer_id": customer_id_ctx.get(),
        "site_id": site_id_ctx.get(),
        "device_id": device_id_ctx.get(),
    }
