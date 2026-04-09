"""Threshold-based alerts for Enterprise AI operational failures (category=ai)."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis_sync import get_redis
from app.services.alert_emit import emit_alert
from app.services.llm_config_service import get_llm_config

log = logging.getLogger(__name__)

_PLANNER_KEY = "ai:planner_fail_15m"
_EXECUTION_KEY = "ai:execution_fail_15m"
_WINDOW_SEC = 900


def _bump_rolling_counter(key_prefix: str, customer_id: uuid.UUID) -> int:
    r = get_redis()
    n = 0
    if r:
        try:
            k = f"{key_prefix}:{customer_id}"
            n = int(r.incr(k))
            if n == 1:
                r.expire(k, _WINDOW_SEC)
        except Exception:
            log.debug("ai failure counter redis miss key=%s", key_prefix, exc_info=True)
    return n


def _llm_alert_params(db: Session | None, customer_id: uuid.UUID | None) -> tuple[int, int]:
    if db and customer_id:
        cfg = get_llm_config(db, customer_id)
        return cfg.llm_failure_threshold, cfg.llm_cooldown_seconds
    return int(settings.ai_alert_llm_failures_threshold), int(settings.ai_alert_llm_cooldown_seconds)


def _pipeline_alert_params(db: Session | None, customer_id: uuid.UUID | None) -> tuple[int, int, int]:
    """Returns planner_thresh, execution_thresh, cooldown_seconds."""
    if db and customer_id:
        cfg = get_llm_config(db, customer_id)
        t = cfg.pipeline_failure_threshold
        return t, t, cfg.pipeline_cooldown_seconds
    return (
        int(settings.ai_alert_planner_failures_threshold),
        int(settings.ai_alert_execution_failures_threshold),
        int(settings.ai_alert_pipeline_cooldown_seconds),
    )


def bump_llm_failure_and_maybe_alert(db: Session | None, customer_id: uuid.UUID | None) -> int:
    r = get_redis()
    n = 0
    if r:
        try:
            k = "ai:health:llm_failures_1h"
            n = int(r.incr(k))
            if n == 1:
                r.expire(k, 3600)
        except Exception:
            log.debug("llm failure counter redis miss", exc_info=True)
    th, cool = _llm_alert_params(db, customer_id)
    if db and customer_id and n >= th:
        _maybe_emit(
            db,
            customer_id=customer_id,
            cooldown_key=f"ai:alert_cooldown:llm:{customer_id}",
            cooldown_ex=max(60, cool),
            title="Enterprise AI: repeated LLM failures",
            message=f"Ollama or LLM summarization failed at least {n} time(s) in the rolling 1h window.",
            severity="warning",
        )
    return n


def bump_planner_failure_and_maybe_alert(
    db: Session | None,
    customer_id: uuid.UUID | None,
    *,
    detail: str | None = None,
) -> int:
    """Plan/guard rejection, invalid site ids in filters, unknown dataset, etc. (no data execution)."""
    if not customer_id:
        return 0
    n = _bump_rolling_counter(_PLANNER_KEY, customer_id)
    pt, _et, pcool = _pipeline_alert_params(db, customer_id)
    if db and n >= pt:
        msg = f"AI plan validation or guard rejected {n} request(s) in ~15 minutes (bad or disallowed plan)."
        if detail:
            msg = f"{msg} Last: {detail[:400]}"
        _maybe_emit(
            db,
            customer_id=customer_id,
            cooldown_key=f"ai:alert_cooldown:planner:{customer_id}",
            cooldown_ex=max(60, pcool),
            title="Enterprise AI: repeated planner / guard failures",
            message=msg,
            severity="warning",
        )
    return n


def bump_execution_failure_and_maybe_alert(
    db: Session | None,
    customer_id: uuid.UUID | None,
    *,
    detail: str | None = None,
) -> int:
    """Postgres/Timescale retrieval errors, timeouts, and other execute_plan failures."""
    if not customer_id:
        return 0
    n = _bump_rolling_counter(_EXECUTION_KEY, customer_id)
    _pt, et, pcool = _pipeline_alert_params(db, customer_id)
    if db and n >= et:
        msg = f"AI data retrieval failed {n} time(s) in ~15 minutes (database or Timescale execution)."
        if detail:
            msg = f"{msg} Last error: {detail[:400]}"
        _maybe_emit(
            db,
            customer_id=customer_id,
            cooldown_key=f"ai:alert_cooldown:execution:{customer_id}",
            cooldown_ex=max(60, pcool),
            title="Enterprise AI: repeated execution / retrieval failures",
            message=msg,
            severity="warning",
        )
    return n


def _maybe_emit(
    db: Session,
    *,
    customer_id: uuid.UUID,
    cooldown_key: str,
    cooldown_ex: int,
    title: str,
    message: str,
    severity: str,
) -> None:
    r = get_redis()
    if not r:
        return
    try:
        if not r.set(cooldown_key, "1", nx=True, ex=max(60, cooldown_ex)):
            return
    except Exception:
        return
    try:
        emit_alert(
            db=db,
            category="ai",
            severity=severity,
            title=title[:255],
            message=message[:2000],
            customer_id=customer_id,
            site_id=None,
            device_id=None,
            source_component="api.ai",
            source_object_type=None,
            source_object_id=None,
            trace_id=None,
        )
    except Exception:
        log.debug("ai failure alert emit skipped", exc_info=True)
        try:
            r.delete(cooldown_key)
        except Exception:
            pass
