"""Dynamic suggested prompts from platform state (cached per user/scope)."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis_sync import get_redis
from app.models.alert import Alert
from app.models.data_object import DataObject
from app.models.device import Device
from app.models.workflow import Workflow
from app.models.workflow_execution import WorkflowExecution
from app.services.ai_cache_service import cache_get_json, cache_set_json


def _scope_key(customer_id: uuid.UUID, user_id: uuid.UUID, site_ids: list[uuid.UUID]) -> str:
    raw = json.dumps([str(customer_id), str(user_id), sorted(str(s) for s in site_ids)])
    h = hashlib.sha256(raw.encode()).hexdigest()[:24]
    return f"ai:suggestions:{h}"


def build_suggestions(
    db: Session,
    *,
    customer_id: uuid.UUID,
    user_id: uuid.UUID,
    site_ids: list[uuid.UUID],
) -> list[dict[str, Any]]:
    key = _scope_key(customer_id, user_id, site_ids)
    cached = cache_get_json(key)
    if isinstance(cached, list) and cached:
        return cached

    crit_q = select(func.count()).select_from(Alert).where(
        Alert.customer_id == customer_id,
        Alert.acknowledged.is_(False),
        Alert.severity == "critical",
    )
    if site_ids:
        crit_q = crit_q.where((Alert.site_id.in_(site_ids)) | (Alert.site_id.is_(None)))
    crit = int(db.scalar(crit_q) or 0)

    unhealthy_q = select(func.count()).select_from(DataObject).where(
        DataObject.customer_id == customer_id,
        DataObject.health_status.in_(("warning", "critical", "error")),
    )
    if site_ids:
        unhealthy_q = unhealthy_q.where(DataObject.site_id.in_(site_ids))
    unhealthy = int(db.scalar(unhealthy_q) or 0)

    failed_q = (
        select(func.count())
        .select_from(WorkflowExecution)
        .join(Workflow, WorkflowExecution.workflow_id == Workflow.id)
        .where(
            Workflow.customer_id == customer_id,
            WorkflowExecution.status.in_(("failed", "error")),
        )
    )
    if site_ids:
        failed_q = failed_q.where(
            (Workflow.site_id.in_(site_ids)) | (Workflow.site_id.is_(None))
        )
    failed_ex = int(db.scalar(failed_q) or 0)

    offline_q = select(func.count()).select_from(Device).where(
        Device.customer_id == customer_id,
        Device.is_active.is_(False),
    )
    if site_ids:
        offline_q = offline_q.where(Device.site_id.in_(site_ids))
    offline_dev = int(db.scalar(offline_q) or 0)

    items: list[dict[str, Any]] = [
        {
            "id": "s1",
            "prompt": "Summarize critical and warning alerts for my selected sites in the last 24 hours.",
            "intent_hint": "alert_summary",
        },
        {
            "id": "s2",
            "prompt": "Which data objects look unhealthy and what sites are they on?",
            "intent_hint": "health_summary",
        },
        {
            "id": "s3",
            "prompt": "Show recent failed workflow executions for my scope.",
            "intent_hint": "workflow_execution_lookup",
        },
        {
            "id": "s4",
            "prompt": "Give a monitoring and queue health overview for the platform.",
            "intent_hint": "monitoring_summary",
        },
        {
            "id": "s5",
            "prompt": "List dashboards in draft vs live status for my customer.",
            "intent_hint": "dashboard_summary",
        },
    ]
    if crit > 0:
        items.insert(
            0,
            {
                "id": "hot_alerts",
                "prompt": f"There are {crit} unacknowledged critical alerts in scope — summarize them by category.",
                "intent_hint": "alert_summary",
            },
        )
    if unhealthy > 0:
        items.insert(
            min(1, len(items)),
            {
                "id": "hot_health",
                "prompt": f"{unhealthy} data objects show degraded health — summarize by severity and site.",
                "intent_hint": "health_summary",
            },
        )
    if failed_ex > 0:
        items.append(
            {
                "id": "hot_wf",
                "prompt": f"{failed_ex} recent workflow executions failed — list patterns and error hints.",
                "intent_hint": "workflow_execution_lookup",
            }
        )
    if offline_dev > 0:
        items.append(
            {
                "id": "hot_dev",
                "prompt": f"{offline_dev} devices are inactive — which sites are affected?",
                "intent_hint": "device_lookup",
            }
        )

    cache_set_json(key, items[:12], settings.ai_suggestions_cache_ttl_seconds)
    try:
        r = get_redis()
        if r:
            ttl = max(int(settings.ai_suggestions_cache_ttl_seconds) * 4, 7200)
            r.set(
                f"ai:suggestions:last_write:{customer_id}",
                datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                ex=ttl,
            )
    except Exception:
        pass
    return items[:12]
