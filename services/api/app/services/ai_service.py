"""Enterprise AI orchestration: intent → plan → guard → execute → optional LLM → audit."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis_sync import get_redis
from app.models.site import Site
from app.models.user import User
from app.schemas.enterprise_ai import AIChatRequest
from app.services.ai_access_policy import apply_raw_debug_gate
from app.services.ai_audit_service import record_query
from app.services.ai_execution_service import execute_plan, window_from_preset
from app.services.ai_failure_alerts import (
    bump_execution_failure_and_maybe_alert,
    bump_planner_failure_and_maybe_alert,
)
from app.services.ai_grounding_service import build_evidence, hints_for_dataset
from app.services.ai_health_service import bump_llm_failure_counter, call_ollama_chat
from app.services.ai_intent_service import classify_intent
from app.services.llm_config_service import get_llm_config
from app.services.ai_prompt_service import (
    build_summary_user_prompt,
    pick_configured_llm_template,
    system_instruction_with_optional_template,
)
from app.services.ai_query_planner import build_plan
from app.services.ai_response_builder import chat_response
from app.services.ai_sql_guard import PlanRejected, validate_and_clamp_plan

log = logging.getLogger(__name__)


def _format_data_object_catalog_row(r: dict[str, Any]) -> str:
    """One-line summary: role-based ai_projection when present; else KPI key names only."""
    nm = str(r.get("name") or r.get("id") or "").strip()
    proj = r.get("ai_projection")
    if isinstance(proj, dict) and proj.get("_meta"):
        chunks: list[str] = []
        for role in ("identity", "display", "metric", "health", "geo", "grouping", "filter", "timestamp"):
            b = proj.get(role)
            if isinstance(b, dict) and b:
                bits = [f"{k}={v}" for k, v in list(b.items())[:8]]
                chunks.append(f"{role}: " + "; ".join(bits))
        return (nm + ": " + " | ".join(chunks)) if chunks else nm
    keys = r.get("kpi_keys")
    if isinstance(keys, list) and keys:
        k2 = ", ".join(str(x) for x in keys[:12])
        return f"{nm} [kpi keys: {k2}] (configure device_objects.mapping.fieldCatalog for role-based AI fields)"
    return nm


def _human_time_preset(preset: str | None) -> str:
    p = (preset or "last_24_hours").lower().replace(" ", "_")
    return {
        "last_24_hours": "Last 24 hours",
        "last_7_days": "Last 7 days",
        "last_30_days": "Last 30 days",
        "last_7d": "Last 7 days",
        "last_30d": "Last 30 days",
        "week": "Last 7 days",
        "month": "Last 30 days",
    }.get(p, (preset or "—").replace("_", " "))


def effective_role(user: User) -> str:
    if user.is_superuser or user.role == "admin":
        return "admin"
    return "operator"


def resolve_site_scope(db: Session, user: User, requested: list[uuid.UUID] | None) -> list[uuid.UUID]:
    if user.is_superuser or user.role == "admin":
        ids = db.scalars(select(Site.id).where(Site.customer_id == user.customer_id)).all()
        allowed = list(ids)
    else:
        allowed = [l.site_id for l in (user.site_links or [])]
    if not requested:
        return allowed
    allow_set = set(allowed)
    for s in requested:
        if s not in allow_set:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "One or more sites are not permitted for this user",
            )
    return list(requested)


def check_rate_limit(user_id: uuid.UUID, *, limit_per_min: int) -> None:
    r = get_redis()
    if not r:
        return
    slot = int(time.time()) // 60
    key = f"ai:chat:rl:{user_id}:{slot}"
    try:
        n = r.incr(key)
        if n == 1:
            r.expire(key, 120)
        if n > max(1, int(limit_per_min)):
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "AI chat rate limit exceeded; try again shortly.",
            )
    except HTTPException:
        raise
    except Exception:
        pass


def _structured_answer(
    *,
    intent: str,
    dataset: str,
    metrics: dict[str, Any],
    rows: list[dict[str, Any]],
) -> str:
    if intent == "unsupported":
        return (
            "I could not map that question to a supported topic. Try asking about alerts, device or site "
            "lists, data object health, workflows, dashboards, published services, or platform monitoring."
        )
    if not rows and dataset != "ai_monitoring_overview":
        return "No matching rows were found for your site scope and time range."

    parts: list[str] = []
    if "critical_count" in metrics:
        parts.append(f"Critical alerts (unacknowledged, in scope): {metrics['critical_count']}.")
    if "by_severity" in metrics:
        parts.append(f"By severity: {metrics['by_severity']}.")
    if "by_category" in metrics:
        parts.append(f"By category: {metrics['by_category']}.")
    if "categories" in metrics:
        parts.append(f"Top categories: {metrics['categories']}.")
    if "by_health" in metrics:
        parts.append(f"Health distribution: {metrics['by_health']}.")
    if intent == "health_summary" and rows and dataset == "ai_data_objects_latest":
        flagged = [r for r in rows if str(r.get("health_status") or "").lower() in ("red", "yellow")]
        if flagged:
            bits: list[str] = []
            for r in flagged[:25]:
                nm = str(r.get("name") or r.get("id") or "").strip() or "(unnamed)"
                sid = str(r.get("site_id") or "").strip()
                hs = str(r.get("health_status") or "").strip()
                bits.append(f"{nm} [site_id={sid}, health={hs}]")
            more = f" (+{len(flagged) - 25} more)" if len(flagged) > 25 else ""
            parts.append(f"Non-green data objects (sample): " + "; ".join(bits) + more + ".")
    if "by_status" in metrics:
        parts.append(f"Status distribution: {metrics['by_status']}.")
    if "top_kpi_keys" in metrics:
        parts.append(f"Frequent KPI keys: {metrics['top_kpi_keys']}.")
    if "monitoring_summary" in metrics:
        s = metrics["monitoring_summary"]
        parts.append(
            f"Monitoring snapshot — API: {s.get('api_status')}, Kafka: {s.get('kafka_status')}, "
            f"open alerts (customer): {s.get('active_alerts')}."
        )
    if metrics.get("source") == "timescale":
        parts.append(
            f"Timescale KPI series ({metrics.get('aggregation')}) — {len(rows)} point(s); "
            f"devices in scope: {metrics.get('device_scope_count', 0)}."
        )
        if metrics.get("span_clamped"):
            parts.append("Time window was clamped to the configured maximum span.")
    if metrics.get("source") == "timescale_health":
        parts.append(
            f"Timescale health series ({metrics.get('aggregation')}) — {len(rows)} row(s); "
            f"devices in scope: {metrics.get('device_scope_count', 0)}."
        )
        if metrics.get("span_clamped"):
            parts.append("Time window was clamped to the configured maximum span.")
    if metrics.get("source") == "published_delivery_logs":
        parts.append(
            f"Publish delivery summary ({metrics.get('aggregation')}) — {len(rows)} row(s) "
            f"from delivery logs joined to published services."
        )
    if intent == "device_lookup" and rows and dataset == "ai_devices":
        roster = []
        for r in rows[:40]:
            nm = str(r.get("name") or r.get("id") or "").strip()
            extra = str(r.get("description") or "").strip()
            if extra:
                roster.append(f"{nm} ({extra[:120]}{'…' if len(extra) > 120 else ''})")
            else:
                roster.append(nm)
        parts.append("Devices: " + "; ".join(roster) + ("." if len(rows) <= 40 else f" … ({len(rows)} devices in scope)."))
    if intent == "data_object_catalog" and rows and dataset == "ai_data_objects_latest":
        lines = [_format_data_object_catalog_row(r) for r in rows[:35]]
        tail = "." if len(rows) <= 35 else f" … ({len(rows)} objects in scope)."
        parts.append(
            "Latest ingested data objects (semantic projection from fieldCatalog when present): "
            + " | ".join(lines)
            + tail
        )
    parts.append(f"Retrieved {len(rows)} row(s) from approved dataset {dataset}.")
    return " ".join(parts)[:4000]


def run_chat(db: Session, user: User, body: AIChatRequest) -> dict[str, Any]:
    msg_l = body.message.strip().lower()
    if msg_l == "__healthcheck__":
        return {
            "answer": "Enterprise AI pipeline OK (healthcheck).",
            "llm_used": False,
            "degraded": False,
            "mode": "structured_only",
            "evidence": {
                "datasets": [],
                "rows_returned": 0,
                "time_range": None,
                "filters_applied": {},
                "warnings": [],
                "rows_clamped": False,
                "span_clamped": False,
            },
            "plan": {"dataset": None, "aggregation": None, "limit": None, "filters": {}, "intent": "healthcheck"},
            "results": {},
        }

    cfg = get_llm_config(db, user.customer_id)
    check_rate_limit(user.id, limit_per_min=cfg.rate_limit_per_min)
    role = effective_role(user)
    sites = resolve_site_scope(db, user, body.site_ids)

    intent_data = apply_raw_debug_gate(
        classify_intent(body.message),
        user_role=role,
        raw_debug_enabled=cfg.enable_raw_debug,
    )

    plan = build_plan(
        intent_payload=intent_data,
        message=body.message,
        site_ids=sites,
        time_range=body.time_range,
        use_llm=body.use_llm,
        debug_raw=body.debug_raw and role == "admin",
        user_role=role,
    )
    try:
        plan = validate_and_clamp_plan(plan, user_role=role)
    except PlanRejected as e:
        bump_planner_failure_and_maybe_alert(db, user.customer_id, detail=str(e))
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    try:
        rows, metrics = execute_plan(
            db,
            customer_id=user.customer_id,
            allowed_site_ids=sites,
            plan=plan,
            query_timeout_seconds=float(cfg.query_timeout_seconds),
        )
    except Exception as e:
        log.exception("Enterprise AI execute_plan failed")
        bump_execution_failure_and_maybe_alert(db, user.customer_id, detail=str(e))
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "AI data retrieval failed (see logs).",
        ) from e

    warnings: list[str] = []
    if not sites:
        warnings.append("No sites in scope for this user; queries returned empty or global monitoring only.")

    tr_preset = str((plan.get("time_range") or {}).get("preset") or body.time_range or "last_24_hours")
    t0, t1 = window_from_preset(tr_preset)
    rows_clamped = bool(metrics.get("rows_clamped"))
    span_clamped = bool(metrics.get("span_clamped"))
    if rows_clamped:
        warnings.append("Row count was capped by the configured maximum for this dataset.")
    if span_clamped:
        warnings.append("Time span was clamped to the configured maximum window.")

    evidence = build_evidence(
        datasets=[str(plan["dataset"])],
        rows_returned=int(metrics.get("rows_returned", len(rows))),
        time_range_label=_human_time_preset(tr_preset),
        time_window_utc={"start": t0.isoformat(), "end": t1.isoformat()},
        filters=plan.get("filters") or {},
        warnings=warnings,
        source_hints=hints_for_dataset(str(plan["dataset"])),
        rows_clamped=rows_clamped,
        span_clamped=span_clamped,
    )

    results: dict[str, Any] = {**metrics, "sample_rows": rows[:20]}

    intent = str(plan.get("intent") or "unsupported")
    structured = _structured_answer(
        intent=intent,
        dataset=str(plan["dataset"]),
        metrics=metrics,
        rows=rows,
    )

    llm_used = False
    degraded = False
    answer = structured
    want_llm = bool(body.use_llm and plan.get("needs_llm") and cfg.enable_llm)

    if want_llm:
        try:
            max_rows = max(5, int(cfg.max_rows))
            max_chars = max(500, int(cfg.max_prompt_chars))
            ev_for_llm = {
                "metrics": metrics,
                "rows": rows[:max_rows],
            }
            user_p = build_summary_user_prompt(
                question=body.message,
                evidence_json=ev_for_llm,
                dataset=str(plan["dataset"]),
            )
            tmpl = pick_configured_llm_template(
                summary_prompt=cfg.summary_prompt,
                incident_prompt=cfg.incident_prompt,
                trend_prompt=cfg.trend_prompt,
                intent=intent,
                dataset=str(plan["dataset"]),
            )
            msgs = [
                {
                    "role": "system",
                    "content": system_instruction_with_optional_template(summary_template=tmpl),
                },
                {
                    "role": "user",
                    "content": user_p[:max_chars],
                },
            ]
            answer = call_ollama_chat(
                msgs,
                timeout=float(cfg.timeout_seconds),
                base_url=cfg.base_url,
                model=cfg.model_name,
            )
            llm_used = True
        except Exception as e:
            log.info("Enterprise AI LLM call failed: %s", e)
            bump_llm_failure_counter(db, user.customer_id)
            degraded = True
            warnings.append("LLM unavailable, returning structured result only.")
            answer = structured

    mode = "structured_plus_llm" if llm_used else "structured_only"

    out = chat_response(
        answer=answer,
        llm_used=llm_used,
        degraded=degraded,
        mode=mode,
        evidence=evidence,
        plan=plan,
        results=results,
        warnings=warnings,
    )

    if msg_l != "__healthcheck__":
        try:
            record_query(
                db,
                user=user,
                site_ids=sites,
                question=body.message,
                intent=intent,
                plan={k: v for k, v in plan.items() if k != "user_message_excerpt"},
                answer=answer,
                llm_used=llm_used,
                degraded=degraded,
                response_mode=mode,
            )
        except Exception:
            log.exception("ai audit record failed")
            db.rollback()

    return out
