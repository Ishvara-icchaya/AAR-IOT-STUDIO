"""Canonical Kafka topic names — docs/ENTERPRISE_FEATURES_EXPORT_UPDATED.md §1.5."""

import logging

from app.core.pipeline_log import emit as pipeline_emit

log = logging.getLogger(__name__)

PLATFORM_TOPICS: tuple[str, ...] = (
    "raw.ingest",
    "raw.archive",
    "scrubber.input",
    "scrubber.output",
    "data_object.created",
    "workflow_object.created",
    "result_object.created",
    "workflow.input",
    "workflow.output",
    "publish.events",
    "alerts.events",
    "monitoring.events",
)


def ensure_platform_topics(bootstrap_servers: str) -> None:
    from kafka.admin import KafkaAdminClient, NewTopic
    from kafka.errors import TopicAlreadyExistsError

    log.debug("ensure_platform_topics bootstrap=%s", bootstrap_servers)
    admin = KafkaAdminClient(bootstrap_servers=bootstrap_servers, client_id="aar-api-init")
    created = 0
    existing = 0
    try:
        for name in PLATFORM_TOPICS:
            try:
                admin.create_topics(
                    [NewTopic(name=name, num_partitions=1, replication_factor=1)],
                    validate_only=False,
                )
                log.debug("created kafka topic %r", name)
                created += 1
            except TopicAlreadyExistsError:
                log.debug("kafka topic already exists %r", name)
                existing += 1
    finally:
        admin.close()
    log.debug("ensure_platform_topics done (%d names)", len(PLATFORM_TOPICS))
    pipeline_emit(
        log,
        component="api.kafka",
        action="ensure_topics",
        status="ok",
        created=created,
        existing=existing,
        total=len(PLATFORM_TOPICS),
    )
