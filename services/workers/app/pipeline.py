import logging
import os
from typing import Any


def _trace_pipeline() -> bool:
    return os.environ.get("AAR_TRACE_PIPELINE", "").lower() in ("1", "true", "yes")


def _level() -> int:
    return logging.INFO if _trace_pipeline() else logging.DEBUG


def emit(logger: logging.Logger, **fields: Any) -> None:
    lvl = _level()
    if not logger.isEnabledFor(lvl):
        return
    extra = {f"aar_{k}": v for k, v in fields.items()}
    logger.log(lvl, "event", extra=extra)
