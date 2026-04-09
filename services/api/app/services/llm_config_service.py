"""Per-customer LLM configuration with env defaults and optional Redis cache."""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis_sync import get_redis
from app.models.llm_config import LlmConfig
from app.schemas.llm_config import LlmConfigRead, LlmConfigUpdate

log = logging.getLogger(__name__)

_CACHE_PREFIX = "llm_config:"
_CACHE_TTL = 300


@dataclass
class EffectiveLlmConfig:
    provider: str
    base_url: str
    model_name: str
    timeout_seconds: float
    max_rows: int
    max_prompt_chars: int
    query_timeout_seconds: int
    rate_limit_per_min: int
    enable_llm: bool
    enable_suggestions: bool
    enable_raw_debug: bool
    llm_failure_threshold: int
    llm_cooldown_seconds: int
    pipeline_failure_threshold: int
    pipeline_cooldown_seconds: int
    summary_prompt: str | None
    incident_prompt: str | None
    trend_prompt: str | None
    updated_at: datetime


def _defaults_effective(customer_id: uuid.UUID) -> EffectiveLlmConfig:
    now = datetime.now(timezone.utc)
    return EffectiveLlmConfig(
        provider="ollama",
        base_url=(settings.ollama_base_url or "http://localhost:11434").strip(),
        model_name=(settings.ollama_model or "llama3").strip(),
        timeout_seconds=float(settings.ai_llm_timeout_seconds),
        max_rows=int(settings.ai_llm_max_rows),
        max_prompt_chars=int(settings.ai_llm_max_prompt_chars),
        query_timeout_seconds=int(settings.ai_query_timeout_seconds),
        rate_limit_per_min=int(settings.ai_chat_rate_limit_per_minute),
        enable_llm=True,
        enable_suggestions=True,
        enable_raw_debug=False,
        llm_failure_threshold=int(settings.ai_alert_llm_failures_threshold),
        llm_cooldown_seconds=int(settings.ai_alert_llm_cooldown_seconds),
        pipeline_failure_threshold=int(settings.ai_alert_planner_failures_threshold),
        pipeline_cooldown_seconds=int(settings.ai_alert_pipeline_cooldown_seconds),
        summary_prompt=None,
        incident_prompt=None,
        trend_prompt=None,
        updated_at=now,
    )


def _row_overrides(row: LlmConfig) -> EffectiveLlmConfig:
    return EffectiveLlmConfig(
        provider=row.provider,
        base_url=row.base_url,
        model_name=row.model_name,
        timeout_seconds=float(row.timeout_seconds),
        max_rows=row.max_rows,
        max_prompt_chars=row.max_prompt_chars,
        query_timeout_seconds=row.query_timeout_seconds,
        rate_limit_per_min=row.rate_limit_per_min,
        enable_llm=row.enable_llm,
        enable_suggestions=row.enable_suggestions,
        enable_raw_debug=row.enable_raw_debug,
        llm_failure_threshold=row.llm_failure_threshold,
        llm_cooldown_seconds=row.llm_cooldown_seconds,
        pipeline_failure_threshold=row.pipeline_failure_threshold,
        pipeline_cooldown_seconds=row.pipeline_cooldown_seconds,
        summary_prompt=row.summary_prompt,
        incident_prompt=row.incident_prompt,
        trend_prompt=row.trend_prompt,
        updated_at=row.updated_at,
    )


def _effective_to_read(customer_id: uuid.UUID, eff: EffectiveLlmConfig) -> LlmConfigRead:
    return LlmConfigRead(
        customer_id=str(customer_id),
        provider=eff.provider,
        base_url=eff.base_url,
        model_name=eff.model_name,
        timeout_seconds=int(eff.timeout_seconds),
        max_rows=eff.max_rows,
        max_prompt_chars=eff.max_prompt_chars,
        query_timeout_seconds=eff.query_timeout_seconds,
        rate_limit_per_min=eff.rate_limit_per_min,
        enable_llm=eff.enable_llm,
        enable_suggestions=eff.enable_suggestions,
        enable_raw_debug=eff.enable_raw_debug,
        llm_failure_threshold=eff.llm_failure_threshold,
        llm_cooldown_seconds=eff.llm_cooldown_seconds,
        pipeline_failure_threshold=eff.pipeline_failure_threshold,
        pipeline_cooldown_seconds=eff.pipeline_cooldown_seconds,
        summary_prompt=eff.summary_prompt,
        incident_prompt=eff.incident_prompt,
        trend_prompt=eff.trend_prompt,
        updated_at=eff.updated_at,
    )


def _cache_get(customer_id: uuid.UUID) -> EffectiveLlmConfig | None:
    r = get_redis()
    if not r:
        return None
    try:
        raw = r.get(f"{_CACHE_PREFIX}{customer_id}")
        if not raw:
            return None
        d = json.loads(raw)
        d["updated_at"] = datetime.fromisoformat(d["updated_at"])
        return EffectiveLlmConfig(**d)
    except Exception:
        log.debug("llm_config cache read miss", exc_info=True)
        return None


def _cache_set(customer_id: uuid.UUID, eff: EffectiveLlmConfig) -> None:
    r = get_redis()
    if not r:
        return
    try:
        d = asdict(eff)
        d["updated_at"] = eff.updated_at.isoformat()
        r.setex(f"{_CACHE_PREFIX}{customer_id}", _CACHE_TTL, json.dumps(d, default=str))
    except Exception:
        log.debug("llm_config cache set miss", exc_info=True)


def invalidate_llm_config_cache(customer_id: uuid.UUID) -> None:
    r = get_redis()
    if not r:
        return
    try:
        r.delete(f"{_CACHE_PREFIX}{customer_id}")
    except Exception:
        pass


def get_llm_config(db: Session, customer_id: uuid.UUID) -> EffectiveLlmConfig:
    cached = _cache_get(customer_id)
    if cached:
        return cached
    base = _defaults_effective(customer_id)
    row = db.scalars(select(LlmConfig).where(LlmConfig.customer_id == customer_id)).first()
    eff = _row_overrides(row) if row else base
    _cache_set(customer_id, eff)
    return eff


def get_llm_config_read(db: Session, customer_id: uuid.UUID) -> LlmConfigRead:
    return _effective_to_read(customer_id, get_llm_config(db, customer_id))


def upsert_llm_config(db: Session, customer_id: uuid.UUID, body: LlmConfigUpdate) -> LlmConfig:
    row = db.scalars(select(LlmConfig).where(LlmConfig.customer_id == customer_id)).first()
    if not row:
        row = LlmConfig(
            id=uuid.uuid4(),
            customer_id=customer_id,
            provider=body.provider.strip().lower(),
            base_url=body.base_url.strip(),
            model_name=body.model_name.strip(),
            timeout_seconds=body.timeout_seconds,
            max_rows=body.max_rows,
            max_prompt_chars=body.max_prompt_chars,
            query_timeout_seconds=body.query_timeout_seconds,
            rate_limit_per_min=body.rate_limit_per_min,
            enable_llm=body.enable_llm,
            enable_suggestions=body.enable_suggestions,
            enable_raw_debug=body.enable_raw_debug,
            llm_failure_threshold=body.llm_failure_threshold,
            llm_cooldown_seconds=body.llm_cooldown_seconds,
            pipeline_failure_threshold=body.pipeline_failure_threshold,
            pipeline_cooldown_seconds=body.pipeline_cooldown_seconds,
            summary_prompt=(body.summary_prompt.strip() if body.summary_prompt else None),
            incident_prompt=(body.incident_prompt.strip() if body.incident_prompt else None),
            trend_prompt=(body.trend_prompt.strip() if body.trend_prompt else None),
        )
        db.add(row)
    else:
        row.provider = body.provider.strip().lower()
        row.base_url = body.base_url.strip()
        row.model_name = body.model_name.strip()
        row.timeout_seconds = body.timeout_seconds
        row.max_rows = body.max_rows
        row.max_prompt_chars = body.max_prompt_chars
        row.query_timeout_seconds = body.query_timeout_seconds
        row.rate_limit_per_min = body.rate_limit_per_min
        row.enable_llm = body.enable_llm
        row.enable_suggestions = body.enable_suggestions
        row.enable_raw_debug = body.enable_raw_debug
        row.llm_failure_threshold = body.llm_failure_threshold
        row.llm_cooldown_seconds = body.llm_cooldown_seconds
        row.pipeline_failure_threshold = body.pipeline_failure_threshold
        row.pipeline_cooldown_seconds = body.pipeline_cooldown_seconds
        row.summary_prompt = body.summary_prompt.strip() if body.summary_prompt else None
        row.incident_prompt = body.incident_prompt.strip() if body.incident_prompt else None
        row.trend_prompt = body.trend_prompt.strip() if body.trend_prompt else None
    db.commit()
    db.refresh(row)
    invalidate_llm_config_cache(customer_id)
    return row


def delete_llm_config_row(db: Session, customer_id: uuid.UUID) -> None:
    row = db.scalars(select(LlmConfig).where(LlmConfig.customer_id == customer_id)).first()
    if row:
        db.delete(row)
        db.commit()
    invalidate_llm_config_cache(customer_id)
