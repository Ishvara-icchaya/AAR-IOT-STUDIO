import logging
import os

log = logging.getLogger(__name__)


def bootstrap_servers() -> list[str]:
    raw = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    servers = [h.strip() for h in raw.split(",") if h.strip()]
    log.debug("_kafka.bootstrap_servers raw=%r -> %s", raw, servers)
    return servers
