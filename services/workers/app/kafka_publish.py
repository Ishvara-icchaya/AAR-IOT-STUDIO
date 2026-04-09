"""Small Kafka producer for worker-ingest → scrubber.input handoff."""

from __future__ import annotations

import json
import logging
import os

from kafka import KafkaProducer
from kafka.errors import KafkaError

log = logging.getLogger(__name__)

_producer: KafkaProducer | None = None


def _bootstrap() -> list[str]:
    raw = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    return [s.strip() for s in raw.split(",") if s.strip()]


def producer() -> KafkaProducer:
    global _producer
    if _producer is None:
        _producer = KafkaProducer(
            bootstrap_servers=_bootstrap(),
            acks="all",
            retries=3,
        )
    return _producer


def publish_json(*, topic: str, key: str, payload: dict) -> None:
    try:
        data = json.dumps(payload, default=str).encode("utf-8")
        future = producer().send(topic, key=key.encode("utf-8"), value=data)
        future.get(timeout=15)
    except KafkaError:
        log.exception("kafka publish failed topic=%s", topic)
        raise


def emit_scrubber_input(envelope: dict) -> None:
    topic = os.environ.get("KAFKA_SCRUBBER_INPUT_TOPIC", "scrubber.input")
    out = dict(envelope)
    out["kind"] = "scrubber_input"
    did = str(out.get("device_id", ""))
    publish_json(topic=topic, key=did, payload=out)


def emit_data_object_created(*, payload: dict) -> None:
    topic = os.environ.get("KAFKA_DATA_OBJECT_CREATED_TOPIC", "data_object.created")
    key = str(payload.get("data_object_id") or payload.get("device_id") or "")
    publish_json(topic=topic, key=key, payload=payload)


def emit_workflow_object_created(*, payload: dict) -> None:
    topic = os.environ.get("KAFKA_WORKFLOW_OBJECT_CREATED_TOPIC", "workflow_object.created")
    key = str(payload.get("workflow_execution_id") or payload.get("workflow_id") or "")
    publish_json(topic=topic, key=key, payload=payload)


def emit_result_object_created(*, payload: dict) -> None:
    topic = os.environ.get("KAFKA_RESULT_OBJECT_CREATED_TOPIC", "result_object.created")
    key = str(payload.get("result_object_id") or payload.get("workflow_id") or "")
    publish_json(topic=topic, key=key, payload=payload)
