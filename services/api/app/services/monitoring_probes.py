"""Infra probes for /monitoring/deep (Kafka, Redis, MinIO, consumer lag, worker heartbeats)."""

from __future__ import annotations

import logging
import os
import socket
from typing import Any

from app.core.config import settings

log = logging.getLogger(__name__)

WORKER_HEARTBEAT_KEY_PREFIX = "aar:worker:heartbeat:"
# Successful raw archive (Postgres+MinIO committed) per protocol; see workers `ingest_archive.touch_last_ingest_redis`.
INGRESS_LAST_INGEST_MQTT_KEY = "aar:ingress:mqtt:last_ingest_at"
# Deprecated; read as fallback until all environments migrated.
LEGACY_MQTT_BRIDGE_LAST_INGEST_REDIS_KEY = "aar:mqtt_bridge:last_ingest_at"

DEFAULT_PIPELINE_WORKERS = (
    "worker-ingest",
    "worker-scrubber",
    "worker-workflow",
    "worker-publish",
    "scheduler",
    "worker-ai",
)


def pipeline_worker_ids() -> tuple[str, ...]:
    raw = os.environ.get("MONITORING_PIPELINE_WORKERS", "")
    if raw.strip():
        return tuple(w.strip() for w in raw.split(",") if w.strip())
    base = list(DEFAULT_PIPELINE_WORKERS)
    if settings.mqtt_bridge_deployed and "worker-mqtt-bridge" not in base:
        idx = base.index("worker-ingest") + 1 if "worker-ingest" in base else len(base)
        base.insert(idx, "worker-mqtt-bridge")
    for wid in (
        "worker-coap-listener",
        "worker-websocket-ingest",
        "worker-rest-poller",
    ):
        if wid in base:
            continue
        if wid == "worker-coap-listener" and settings.coap_listener_deployed:
            base.append(wid)
        elif wid == "worker-websocket-ingest" and settings.websocket_ingest_deployed:
            base.append(wid)
        elif wid == "worker-rest-poller" and settings.rest_poller_deployed:
            base.append(wid)
    return tuple(base)


def probe_mqtt_tcp(host: str, port: int, *, timeout: float = 2.0) -> tuple[bool, str | None]:
    h = (host or "").strip() or "127.0.0.1"
    try:
        p = int(port)
    except (TypeError, ValueError):
        return False, "invalid port"
    sock: socket.socket | None = None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((h, p))
        return True, None
    except OSError as e:
        return False, str(e)[:500]
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass


def probe_redis(url: str) -> tuple[bool, str | None]:
    try:
        import redis

        c = redis.from_url(
            url,
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=True,
        )
        try:
            c.ping()
            return True, None
        finally:
            try:
                c.close()
            except Exception:
                pass
    except Exception as e:
        return False, str(e)[:500]


def probe_kafka(bootstrap_csv: str) -> tuple[bool, str | None]:
    servers = [s.strip() for s in bootstrap_csv.split(",") if s.strip()]
    if not servers:
        return False, "no bootstrap servers"
    admin = None
    try:
        from kafka.admin import KafkaAdminClient

        admin = KafkaAdminClient(
            bootstrap_servers=servers,
            client_id="aar-monitoring-deep",
            request_timeout_ms=8000,
        )
        admin.describe_cluster()
        return True, None
    except Exception as e:
        return False, str(e)[:500]
    finally:
        if admin is not None:
            try:
                admin.close()
            except Exception:
                pass


def probe_minio() -> tuple[bool, str | None]:
    try:
        from app.services import minio_raw

        client = minio_raw.raw_archive_client()
        if not client.bucket_exists(settings.minio_bucket_raw):
            return False, f"bucket {settings.minio_bucket_raw!r} missing"
        return True, None
    except Exception as e:
        return False, str(e)[:500]


def _topic_scrubber() -> str:
    return os.environ.get("KAFKA_SCRUBBER_INPUT_TOPIC", "scrubber.input")


def _topic_data_object() -> str:
    return os.environ.get("KAFKA_DATA_OBJECT_CREATED_TOPIC", "data_object.created")


def _topic_result_object() -> str:
    return os.environ.get("KAFKA_RESULT_OBJECT_CREATED_TOPIC", "result_object.created")


def consumer_group_lag_messages(bootstrap_csv: str, group_id: str, topics: tuple[str, ...]) -> int | None:
    """Sum partition lag for `topics` in this consumer group. None if unavailable."""
    from kafka import KafkaConsumer, TopicPartition
    from kafka.admin import KafkaAdminClient

    servers = [s.strip() for s in bootstrap_csv.split(",") if s.strip()]
    if not servers or not topics:
        return None
    admin = None
    consumer = None
    try:
        admin = KafkaAdminClient(
            bootstrap_servers=servers,
            client_id="aar-monitoring-lag",
            request_timeout_ms=10000,
        )
        try:
            committed = admin.list_consumer_group_offsets(group_id)
        except Exception:
            log.debug("list_consumer_group_offsets failed group=%s", group_id, exc_info=True)
            return None

        consumer = KafkaConsumer(
            bootstrap_servers=servers,
            enable_auto_commit=False,
            consumer_timeout_ms=5000,
        )

        tset = set(topics)
        tps: list[TopicPartition] = []
        for tp in committed:
            if tp.topic in tset:
                tps.append(tp)

        if not tps:
            for t in topics:
                parts = consumer.partitions_for_topic(t)
                if not parts:
                    continue
                tps.extend(TopicPartition(t, p) for p in parts)

        if not tps:
            return 0

        ends = consumer.end_offsets(tps)
        total = 0
        for tp in tps:
            end = int(ends.get(tp, 0))
            meta = committed.get(tp)
            if meta is None:
                total += end
                continue
            off = int(meta.offset)
            if off < 0:
                total += end
            else:
                total += max(0, end - off)
        return total
    except Exception:
        log.debug("consumer_group_lag_messages failed", exc_info=True)
        return None
    finally:
        if consumer is not None:
            try:
                consumer.close()
            except Exception:
                pass
        if admin is not None:
            try:
                admin.close()
            except Exception:
                pass


def pipeline_consumer_lag_report(bootstrap_csv: str) -> dict[str, Any]:
    """Per known pipeline group: topic list and lag (null if unknown)."""
    specs: tuple[tuple[str, tuple[str, ...]], ...] = (
        ("worker-ingest", (settings.kafka_raw_ingest_topic,)),
        ("worker-scrubber", (_topic_scrubber(),)),
        ("worker-workflow", (_topic_data_object(),)),
        (
            "worker-publish",
            (_topic_data_object(), _topic_result_object()),
        ),
    )
    out: dict[str, Any] = {}
    for gid, tops in specs:
        lag = consumer_group_lag_messages(bootstrap_csv, gid, tops)
        out[gid] = {"topics": list(tops), "lag_messages": lag}
    return out


def topic_log_end_offset_sum(bootstrap_csv: str, topic: str) -> int | None:
    """Approximate retained messages (sum of high-water offsets) for a topic."""
    from kafka import KafkaConsumer, TopicPartition

    servers = [s.strip() for s in bootstrap_csv.split(",") if s.strip()]
    if not servers or not topic:
        return None
    consumer = None
    try:
        consumer = KafkaConsumer(
            bootstrap_servers=servers,
            enable_auto_commit=False,
            consumer_timeout_ms=5000,
        )
        parts = consumer.partitions_for_topic(topic)
        if not parts:
            return 0
        tps = [TopicPartition(topic, p) for p in parts]
        ends = consumer.end_offsets(tps)
        return int(sum(int(ends.get(tp, 0)) for tp in tps))
    except Exception:
        log.debug("topic_log_end_offset_sum failed topic=%s", topic, exc_info=True)
        return None
    finally:
        if consumer is not None:
            try:
                consumer.close()
            except Exception:
                pass


def missing_worker_heartbeats(r: Any, worker_ids: tuple[str, ...]) -> list[str]:
    missing: list[str] = []
    for wid in worker_ids:
        try:
            if not r.exists(WORKER_HEARTBEAT_KEY_PREFIX + wid):
                missing.append(wid)
        except Exception:
            log.debug("heartbeat read failed worker=%s", wid, exc_info=True)
            missing.append(wid)
    return missing
