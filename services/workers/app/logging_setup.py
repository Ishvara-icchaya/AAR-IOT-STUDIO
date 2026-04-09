import logging
import os
import sys

from app.json_log import JsonLogFormatter


def configure_logging() -> None:
    raw = (
        os.environ.get("AAR_LOG_LEVEL") or os.environ.get("LOG_LEVEL", "INFO")
    ).upper()
    level = getattr(logging, raw, logging.INFO)
    json_on = os.environ.get("AAR_LOG_JSON", "").lower() in ("1", "true", "yes")
    fmt = JsonLogFormatter() if json_on else logging.Formatter(
        "%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(fmt)
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(h)
    root.setLevel(level)

    logging.getLogger("kafka").setLevel(logging.INFO)
    logging.getLogger("kafka.conn").setLevel(logging.INFO)
    if os.environ.get("KAFKA_PYTHON_DEBUG", "").lower() in ("1", "true", "yes"):
        logging.getLogger("kafka").setLevel(logging.DEBUG)
        logging.getLogger("kafka.conn").setLevel(logging.DEBUG)
