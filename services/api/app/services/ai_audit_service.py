"""Persist Enterprise AI turns for audit / recent-queries UI."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai_query import AiQuery
from app.models.user import User


def record_query(
    db: Session,
    *,
    user: User,
    site_ids: list[uuid.UUID],
    question: str,
    intent: str,
    plan: dict[str, Any],
    answer: str,
    llm_used: bool,
    degraded: bool,
    response_mode: str | None = None,
) -> uuid.UUID:
    row = AiQuery(
        customer_id=user.customer_id,
        user_id=user.id,
        site_scope_json=[str(s) for s in site_ids],
        question=question[:8000],
        intent=intent[:64],
        plan_json=plan,
        answer_text=answer[:16000],
        llm_used=llm_used,
        degraded=degraded,
        response_mode=(response_mode[:32] if response_mode else None),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.id
