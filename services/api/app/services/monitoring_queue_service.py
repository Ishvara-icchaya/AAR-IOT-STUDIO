"""Kafka topic / consumer lag rows for monitoring UI."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.services import monitoring_probes

log = logging.getLogger(__name__)

# Topics shown in Queues tab with consumer groups that read them (lag = max across groups).
TOPIC_QUEUE_ROWS: tuple[dict[str, Any], ...] = (
    {"topic": "raw.ingest", "groups": ("worker-ingest",)},
    {"topic": "scrubber.input", "groups": ("worker-scrubber",)},
    {"topic": "data_object.created", "groups": ("worker-workflow", "worker-publish")},
    {"topic": "workflow_object.created", "groups": ("worker-workflow", "worker-publish")},
    {"topic": "result_object.created", "groups": ("worker-publish",)},
    {"topic": "publish.events", "groups": ()},
    {"topic": "alerts.events", "groups": ()},
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _lag_for_group(lag_report: dict[str, Any], gid: str) -> int | None:
    block = lag_report.get(gid) or {}
    return block.get("lag_messages")


def build_queue_rows(
    *,
    kafka_ok: bool,
    lag_report: dict[str, Any],
    r: Any | None,
    worker_ids: tuple[str, ...],
    lag_threshold: int,
) -> list[dict[str, Any]]:
    if not kafka_ok:
        return []

    bootstrap = settings.kafka_bootstrap_servers
    rows: list[dict[str, Any]] = []

    for spec in TOPIC_QUEUE_ROWS:
        topic = spec["topic"]
        groups: tuple[str, ...] = spec["groups"]
        messages = monitoring_probes.topic_log_end_offset_sum(bootstrap, topic)
        lags: list[int] = []
        for gid in groups:
            v = _lag_for_group(lag_report, gid)
            if v is not None:
                lags.append(v)
        lag = max(lags) if lags else None

        consumers = 0
        for gid in groups:
            if gid in worker_ids and r is not None:
                try:
                    if r.exists(monitoring_probes.WORKER_HEARTBEAT_KEY_PREFIX + gid):
                        consumers += 1
                except Exception:
                    pass
            elif gid in worker_ids:
                pass

        if lag is None and not groups:
            lag = None

        st = "healthy"
        if lag is not None and lag > lag_threshold:
            st = "warning"
        if lag is not None and lag > lag_threshold * 5:
            st = "critical"

        rows.append(
            {
                "topic": topic,
                "queue_type": "kafka",
                "messages": messages,
                "lag": lag,
                "consumers": consumers if groups else None,
                "last_event_at": _now_iso(),
                "status": st,
            }
        )

    return rows
