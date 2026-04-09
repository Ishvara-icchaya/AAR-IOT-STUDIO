"""Admin platform ports API — /api/v1/admin/ports"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.pipeline_log import emit as pipeline_emit
from app.db.session import get_db
from app.models.user import User
from app.schemas.platform_port import (
    PlatformPortsConfigRead,
    PlatformPortsConfigUpdate,
    PlatformPortsRestartResponse,
    PlatformPortsTestResponse,
)
from app.services.port_config_service import get_ports_config_read, test_ports_config, upsert_ports_config
from app.services.port_config_validation import validate_ports_update
from app.services.port_restart_service import request_platform_restart

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("/ports", response_model=PlatformPortsConfigRead)
def get_ports(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> PlatformPortsConfigRead:
    return get_ports_config_read(db, admin.customer_id)


@router.put("/ports", response_model=PlatformPortsConfigRead)
def put_ports(
    body: PlatformPortsConfigUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> PlatformPortsConfigRead:
    body = validate_ports_update(body)
    out = upsert_ports_config(db, admin.customer_id, body)
    pipeline_emit(
        log,
        component="api.admin.ports",
        action="ports_config_saved",
        status="ok",
        customer_id=str(admin.customer_id),
        user_id=str(admin.id),
    )
    return out


@router.post("/ports/test", response_model=PlatformPortsTestResponse)
def post_ports_test(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> PlatformPortsTestResponse:
    out = test_ports_config(db, admin.customer_id)
    pipeline_emit(
        log,
        component="api.admin.ports",
        action="ports_config_tested",
        status="ok" if out.success else "failed",
        customer_id=str(admin.customer_id),
        user_id=str(admin.id),
    )
    return out


@router.post("/ports/restart", response_model=PlatformPortsRestartResponse)
def post_ports_restart(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> PlatformPortsRestartResponse:
    _ = db
    msg = request_platform_restart(customer_id=admin.customer_id, user_id=admin.id)
    pipeline_emit(
        log,
        component="api.admin.ports",
        action="ports_restart_requested",
        status="ok",
        customer_id=str(admin.customer_id),
        user_id=str(admin.id),
    )
    return PlatformPortsRestartResponse(success=True, message=msg)
