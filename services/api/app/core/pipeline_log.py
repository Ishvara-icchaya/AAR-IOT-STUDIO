"""Structured pipeline checkpoints (ingest → scrubber → workflow → …)."""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from app.core.mask import mask_mapping
from app.core.request_context import snapshot


def _trace_pipeline_enabled() -> bool:
    return os.environ.get("AAR_TRACE_PIPELINE", "").lower() in ("1", "true", "yes")


def _level_for_checkpoint() -> int:
    return logging.INFO if _trace_pipeline_enabled() else logging.DEBUG


def emit(
    logger: logging.Logger,
    *,
    component: str,
    action: str,
    status: str,
    duration_ms: float | None = None,
    error: str | None = None,
    **fields: Any,
) -> None:
    """Emit one structured log record; merges request context. Never put secrets in **fields."""
    level = _level_for_checkpoint()
    if not logger.isEnabledFor(level):
        return
    ctx = {k: v for k, v in snapshot().items() if v is not None}
    payload: dict[str, Any] = {
        "component": component,
        "action": action,
        "status": status,
        **ctx,
        **fields,
    }
    if duration_ms is not None:
        payload["duration_ms"] = round(duration_ms, 3)
    if error:
        payload["error"] = error[:2000]
    payload = mask_mapping(payload)
    extra = {f"aar_{k}": v for k, v in payload.items()}
    logger.log(level, f"{component}.{action}", extra=extra)


@contextmanager
def timed_action(
    logger: logging.Logger,
    *,
    component: str,
    action: str,
) -> Iterator[dict[str, Any]]:
    """Context manager: emits action start/end with duration_ms."""
    fields: dict[str, Any] = {}
    t0 = time.perf_counter()
    emit(logger, component=component, action=f"{action}.start", status="started")
    err: str | None = None
    try:
        yield fields
        status = "ok"
    except Exception as e:
        err = str(e)
        status = "error"
        raise
    finally:
        duration_ms = (time.perf_counter() - t0) * 1000
        emit(
            logger,
            component=component,
            action=f"{action}.end",
            status=status,
            duration_ms=duration_ms,
            error=err,
            **fields,
        )
