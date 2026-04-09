"""worker-publish — data_object.created / result_object.created → external publish."""

import json
import logging

from kafka import KafkaConsumer

from app._kafka import bootstrap_servers
from app.logging_setup import configure_logging
from app.pipeline import emit
from app.publish_engine import process_kafka_value
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)

_TOPICS = (
    "data_object.created",
    "result_object.created",
)


def main() -> None:
    log.debug("worker-publish main() starting")
    servers = bootstrap_servers()
    consumer = KafkaConsumer(
        *_TOPICS,
        bootstrap_servers=servers,
        group_id="worker-publish",
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        value_deserializer=lambda b: json.loads(b.decode("utf-8")) if b else {},
    )
    emit(
        log,
        component="worker-publish",
        action="subscriber_started",
        status="ok",
        topics=",".join(_TOPICS),
        group_id="worker-publish",
    )
    log.info("worker-publish listening on %s", _TOPICS)
    start_worker_heartbeat("worker-publish")
    for msg in consumer:
        try:
            process_kafka_value(msg.value if isinstance(msg.value, dict) else {})
            emit(
                log,
                component="worker-publish",
                action="batch_ok",
                status="ok",
                partition=msg.partition,
                offset=msg.offset,
            )
        except Exception:
            log.exception("worker-publish message failed partition=%s", msg.partition)
            emit(
                log,
                component="worker-publish",
                action="batch_error",
                status="error",
                partition=msg.partition,
                offset=msg.offset,
            )


if __name__ == "__main__":
    main()
