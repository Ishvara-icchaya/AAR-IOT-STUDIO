"""Insert alerts from workers + optional Redis mirrors."""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any

import psycopg2

from app.alert_category import normalize_alert_category
from app.alert_severity import normalize_severity

log = logging.getLogger(__name__)


def _db_url() -> str:
    u = os.environ.get("METADATA_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    return u.replace("postgresql+psycopg2://", "postgresql://")


def _redis_client() -> Any | None:
    url = os.environ.get("REDIS_URL", "")
    if not url:
        return None
    try:
        import redis

        r = redis.from_url(url, decode_responses=True)
        r.ping()
        return r
    except Exception:
        log.debug("worker alert_emit: redis skip", exc_info=True)
        return None


def emit_alert(
    *,
    category: str,
    severity: str,
    title: str,
    message: str | None = None,
    customer_id: str,
    site_id: str | None = None,
    device_id: str | None = None,
    source_component: str | None = None,
    source_object_type: str | None = None,
    source_object_id: str | None = None,
    trace_id: str | None = None,
) -> str:
    sev = normalize_severity(severity)
    cat = normalize_alert_category(category)
    aid = str(uuid.uuid4())
    sql = """
    INSERT INTO alerts (
      id, customer_id, site_id, device_id, category, severity, title, message,
      source_component, source_object_type, source_object_id, trace_id,
      acknowledged, acknowledged_at, acknowledged_by_user_id, created_at
    ) VALUES (
      %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s, %s, %s, %s,
      %s, %s, %s::uuid, %s,
      false, NULL, NULL, NOW()
    )
    """
    conn = psycopg2.connect(_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                sql,
                (
                    aid,
                    customer_id,
                    site_id,
                    device_id,
                    cat,
                    sev[:16],
                    title[:255],
                    (message or "")[:20000],
                    (source_component[:100] if source_component else None),
                    (source_object_type[:64] if source_object_type else None),
                    source_object_id,
                    trace_id[:128] if trace_id else None,
                ),
            )
        conn.commit()
    finally:
        conn.close()

    _redis_touch(
        customer_id=customer_id,
        site_id=site_id,
        severity=sev,
        alert_blob={
            "id": aid,
            "title": title,
            "category": category,
            "customer_id": customer_id,
        },
    )
    log.debug("worker emit_alert id=%s category=%s", aid, category)
    return aid


def _redis_touch(*, customer_id: str, site_id: str | None, severity: str, alert_blob: dict) -> None:
    r = _redis_client()
    if not r:
        return
    try:
        # Approximate counters; API reconcile resets on acknowledge.
        r.incr(f"alerts:unacked:count:{customer_id}")
        if site_id:
            r.incr(f"alerts:unacked:site:{site_id}")
        if severity == "critical":
            r.lpush("alerts:latest:critical", json.dumps(alert_blob, default=str))
            r.ltrim("alerts:latest:critical", 0, 99)
    except Exception:
        log.debug("redis touch failed", exc_info=True)


def redis_set_service_status(service_id: str, payload: dict) -> None:
    r = _redis_client()
    if not r:
        return
    try:
        r.set(
            f"published_service:last_status:{service_id}",
            json.dumps(payload, default=str),
            ex=86400,
        )
    except Exception:
        log.debug("redis service status failed", exc_info=True)
