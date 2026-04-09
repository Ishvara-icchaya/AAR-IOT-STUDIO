"""Admin LLM configuration API — /api/v1/admin/llm-config"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.pipeline_log import emit as pipeline_emit
from app.db.session import get_db
from app.models.user import User
from app.schemas.llm_config import (
    LlmConfigRead,
    LlmConfigResetResponse,
    LlmConfigTestResponse,
    LlmConfigUpdate,
)
from app.services.llm_config_service import (
    delete_llm_config_row,
    get_llm_config_read,
    upsert_llm_config,
)
from app.services.llm_config_validation import validate_llm_config_update
from app.services.llm_connection_test_service import test_ollama_connection

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("/llm-config", response_model=LlmConfigRead)
def get_llm_config(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> LlmConfigRead:
    return get_llm_config_read(db, admin.customer_id)


@router.put("/llm-config", response_model=LlmConfigRead)
def put_llm_config(
    body: LlmConfigUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> LlmConfigRead:
    body = validate_llm_config_update(body)
    upsert_llm_config(db, admin.customer_id, body)
    out = get_llm_config_read(db, admin.customer_id)
    pipeline_emit(
        log,
        component="api.admin.llm_config",
        action="llm_config_saved",
        status="ok",
        customer_id=str(admin.customer_id),
        user_id=str(admin.id),
    )
    return out


@router.post("/llm-config/test", response_model=LlmConfigTestResponse)
def test_llm_config(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> LlmConfigTestResponse:
    cfg = get_llm_config_read(db, admin.customer_id)
    probe = test_ollama_connection(
        base_url=cfg.base_url,
        model_name=cfg.model_name,
        timeout_sec=min(15.0, float(cfg.timeout_seconds)),
    )
    pipeline_emit(
        log,
        component="api.admin.llm_config",
        action="llm_config_tested",
        status="ok" if probe["success"] else "failed",
        customer_id=str(admin.customer_id),
        user_id=str(admin.id),
    )
    return LlmConfigTestResponse(
        success=bool(probe["success"]),
        provider=cfg.provider,
        base_url=cfg.base_url,
        model_name=cfg.model_name,
        message=str(probe["message"]),
        available_models=probe.get("available_models"),
    )


@router.post("/llm-config/reset", response_model=LlmConfigResetResponse)
def reset_llm_config(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> LlmConfigResetResponse:
    delete_llm_config_row(db, admin.customer_id)
    cfg = get_llm_config_read(db, admin.customer_id)
    pipeline_emit(
        log,
        component="api.admin.llm_config",
        action="llm_config_reset",
        status="ok",
        customer_id=str(admin.customer_id),
        user_id=str(admin.id),
    )
    return LlmConfigResetResponse(success=True, config=cfg)
