"""Optional Kafka publish for raw.ingest (lazy producer)."""

from __future__ import annotations

import logging

from kafka import KafkaProducer
from kafka.errors import KafkaError

from app.core.config import settings

log = logging.getLogger(__name__)

_producer: KafkaProducer | None = None


def _bootstrap_list() -> list[str]:
    return [s.strip() for s in settings.kafka_bootstrap_servers.split(",") if s.strip()]


def get_producer() -> KafkaProducer:
    global _producer
    if _producer is None:
        _producer = KafkaProducer(
            bootstrap_servers=_bootstrap_list(),
            acks="all",
            retries=3,
        )
    return _producer


def shutdown_producer() -> None:
    global _producer
    if _producer is not None:
        try:
            _producer.flush(timeout=10)
            _producer.close(timeout=10)
        except Exception:
            log.exception("Kafka producer shutdown")
        _producer = None


def publish_raw_ingest(*, key_device_id: str, value: bytes) -> None:
    prod = get_producer()
    future = prod.send(
        settings.kafka_raw_ingest_topic,
        key=key_device_id.encode("utf-8"),
        value=value,
    )
    future.get(timeout=10)
