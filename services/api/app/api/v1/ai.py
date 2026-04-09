import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.ai_query import AiQuery, AiSavedQuery
from app.models.user import User
from app.schemas.enterprise_ai import (
    AIChatRequest,
    AIChatResponse,
    AIRecentQueryRead,
    AISavedQueryCreate,
    AISavedQueryRead,
)
from app.services.ai_dataset_registry import dataset_public_meta
from app.services.ai_health_service import ai_health_payload
from app.services.ai_service import resolve_site_scope, run_chat
from app.services.llm_config_service import get_llm_config
from app.services.ai_suggestion_service import build_suggestions

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("/datasets")
def list_datasets(user: User = Depends(get_current_user)) -> dict:
    _ = user
    return {"items": dataset_public_meta()}


@router.get("/health")
def ai_health(user: User = Depends(get_current_user)) -> dict:
    _ = user
    return ai_health_payload()


@router.post("/chat", response_model=AIChatResponse)
def chat(
    body: AIChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIChatResponse:
    try:
        data = run_chat(db, user, body)
        return AIChatResponse.model_validate(data)
    except HTTPException:
        raise


@router.get("/suggestions")
def suggestions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    cfg = get_llm_config(db, user.customer_id)
    if not cfg.enable_suggestions:
        return {"items": []}
    sites = resolve_site_scope(db, user, None)
    items = build_suggestions(db, customer_id=user.customer_id, user_id=user.id, site_ids=sites)
    return {"items": items}


@router.get("/recent-queries", response_model=list[AIRecentQueryRead])
def recent_queries(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = 25,
) -> list[AIRecentQueryRead]:
    lim = max(1, min(limit, 100))
    rows = db.scalars(
        select(AiQuery)
        .where(AiQuery.user_id == user.id)
        .order_by(AiQuery.created_at.desc())
        .limit(lim)
    ).all()
    return [AIRecentQueryRead.model_validate(r) for r in rows]


@router.get("/saved-queries", response_model=list[AISavedQueryRead])
def list_saved(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AISavedQueryRead]:
    rows = db.scalars(
        select(AiSavedQuery)
        .where(AiSavedQuery.user_id == user.id)
        .order_by(AiSavedQuery.created_at.desc())
    ).all()
    return [AISavedQueryRead.model_validate(r) for r in rows]


@router.post("/saved-queries", response_model=AISavedQueryRead, status_code=status.HTTP_201_CREATED)
def create_saved(
    body: AISavedQueryCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AISavedQueryRead:
    row = AiSavedQuery(
        customer_id=user.customer_id,
        user_id=user.id,
        name=body.name.strip(),
        question=body.question.strip(),
        default_site_scope_json=list(body.default_site_scope_json),
        default_time_range=body.default_time_range,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return AISavedQueryRead.model_validate(row)


@router.post("/save-query", response_model=AISavedQueryRead, status_code=status.HTTP_201_CREATED)
def save_query_alias(
    body: AISavedQueryCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AISavedQueryRead:
    return create_saved(body, user, db)


@router.delete("/saved-queries/{saved_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved(
    saved_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    row = db.get(AiSavedQuery, saved_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved query not found")
    db.delete(row)
    db.commit()
