"""Application-wide logging: text or JSON lines; see run.sh debug / AAR_* env."""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any


class JsonLogFormatter(logging.Formatter):
    """One JSON object per line; merges LogRecord attributes prefixed with aar_."""

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat()
        payload: dict[str, Any] = {
            "ts": ts,
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info).rstrip("\n")
        for key, val in record.__dict__.items():
            if key.startswith("aar_"):
                payload[key[4:]] = val
        return json.dumps(payload, default=str)


class KeyValueFormatter(logging.Formatter):
    """Human-friendly single line with aar_ extras."""

    def __init__(self) -> None:
        super().__init__(
            fmt="%(asctime)s %(levelname)s [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        extras = []
        for key, val in record.__dict__.items():
            if key.startswith("aar_"):
                extras.append(f"{key[4:]}={val!r}")
        if extras:
            return f"{base} | {' '.join(extras)}"
        return base


def configure_logging(
    level_name: str | None = None,
    *,
    json_format: bool | None = None,
) -> int:
    raw = (level_name or os.environ.get("AAR_LOG_LEVEL") or os.environ.get("LOG_LEVEL", "INFO")).upper()
    level = getattr(logging, raw, logging.INFO)

    if json_format is None:
        json_format = os.environ.get("AAR_LOG_JSON", "").lower() in ("1", "true", "yes")

    fmt = JsonLogFormatter() if json_format else KeyValueFormatter()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(fmt)
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    logging.getLogger("kafka").setLevel(logging.INFO)
    logging.getLogger("kafka.conn").setLevel(logging.INFO)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)

    if os.environ.get("KAFKA_PYTHON_DEBUG", "").lower() in ("1", "true", "yes"):
        logging.getLogger("kafka").setLevel(logging.DEBUG)
        logging.getLogger("kafka.conn").setLevel(logging.DEBUG)

    return level
