"""OTA campaigns (Phase 11) and target completion (Phase 5)."""

import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import (
    OtaWorkPollIntegration,
    OtaWorkPollJwtUser,
    get_current_user,
    get_ota_status_actor,
    get_ota_work_poll_identity,
)
from app.db.session import get_db
from app.models.ota_campaign import OtaCampaign
from app.models.user import User
from app.schemas.ota import (
    FirmwareArtifactCreate,
    FirmwareArtifactListResponse,
    FirmwareArtifactRead,
    OtaAddTargetsRequest,
    OtaAddTargetsResponse,
    OtaCampaignCreate,
    OtaCampaignDetailRead,
    OtaCampaignListResponse,
    OtaCampaignRead,
    OtaCampaignTargetRead,
    OtaCampaignUpdate,
    OtaEventListResponse,
    OtaEventRead,
    OtaExecutorArtifactBlock,
    OtaExecutorWorkItemRead,
    OtaExecutorWorkListResponse,
    OtaProgressReport,
    OtaSimulatorPublicPollResponse,
    OtaTargetClaimRequest,
    OtaTargetStatusReport,
    OtaTargetStatusResponse,
)
from app.services.ota_campaign_service import (
    _MISSING,
    add_targets,
    approve_campaign,
    cancel_campaign,
    create_campaign,
    create_firmware_artifact,
    ensure_campaign_site_readable,
    launch_campaign,
    list_campaigns_for_user,
    list_events,
    list_firmware_artifacts,
    load_campaign,
    pause_campaign,
    remove_target,
    resume_campaign,
    submit_for_approval,
    update_campaign_draft,
)
from app.services.ota_completion_service import (
    complete_ota_target,
    complete_ota_target_via_public_simulator,
)
from app.services.ota_executor_service import (
    OtaExecutorWorkItem,
    claim_ota_target,
    list_executor_work,
    list_ota_targets_bearer_scoped,
    list_public_campaign_poll_work,
    report_ota_progress,
)
from app.services.permission_service import user_has_site_permission

router = APIRouter()


def build_ota_simulator_poll_url(request: Request, campaign_id: uuid.UUID, token: str) -> str:
    root = str(request.base_url).rstrip("/")
    return f"{root}/api/v1/ota/public/campaigns/{campaign_id}/poll?token={quote(token, safe='')}"


def build_ota_simulator_status_url(request: Request, campaign_id: uuid.UUID, token: str) -> str:
    root = str(request.base_url).rstrip("/")
    return f"{root}/api/v1/ota/public/campaigns/{campaign_id}/status?token={quote(token, safe='')}"


def _work_item_read(row: OtaExecutorWorkItem) -> OtaExecutorWorkItemRead:
    art = row.artifact or {}
    return OtaExecutorWorkItemRead(
        campaign_id=row.campaign_id,
        target_id=row.target_id,
        device_id=row.device_id,
        device_display_id=row.device_display_id,
        resolved_device_id=row.resolved_device_id,
        target_firmware_version=row.target_firmware_version,
        target_device_version_id=row.target_device_version_id,
        artifact=OtaExecutorArtifactBlock(
            url=art.get("url"),
            sha256=art.get("sha256"),
            signature=art.get("signature"),
            signature_algorithm=art.get("signature_algorithm"),
            size_bytes=art.get("size_bytes"),
            release_notes=art.get("release_notes"),
        ),
    )


@router.get("/public/campaigns/{campaign_id}/poll", response_model=OtaSimulatorPublicPollResponse)
def public_ota_campaign_poll(
    campaign_id: uuid.UUID,
    token: str = Query(..., min_length=16, max_length=96),
    limit: int = Query(100, ge=1, le=500),
    cursor: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Poll pending ``command_sent`` work for this campaign (no JWT; ``token`` minted at launch).

    Intended for lab OTA simulators and upstream device-update harnesses. Treat the URL as a secret.
    """
    items, next_cursor, name, cstatus, hint = list_public_campaign_poll_work(
        db,
        campaign_id=campaign_id,
        token=token,
        limit=limit,
        cursor=cursor,
    )
    return OtaSimulatorPublicPollResponse(
        campaign_id=campaign_id,
        campaign_name=name,
        campaign_status=cstatus,
        hint=hint,
        items=[_work_item_read(i) for i in items],
        next_cursor=next_cursor,
    )


@router.post("/public/campaigns/{campaign_id}/status", response_model=OtaTargetStatusResponse, status_code=status.HTTP_200_OK)
def public_ota_campaign_status(
    campaign_id: uuid.UUID,
    body: OtaTargetStatusReport,
    token: str = Query(..., min_length=16, max_length=96),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    """Report terminal status for one target using the same secret as the public poll URL (no JWT).

    Lineage actor is the campaign ``created_by`` user, or ``OTA_API_ACTOR_USER_ID`` when the creator is unset.
    """
    if not idempotency_key or not idempotency_key.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Idempotency-Key header is required")
    tgt = complete_ota_target_via_public_simulator(
        db,
        campaign_id=campaign_id,
        token=token,
        target_id=body.target_id,
        new_status=body.status,
        command_id=body.command_id,
        message=body.message,
        ota_external_ref=body.ota_external_ref,
        payload=body.payload,
        idempotency_key=idempotency_key.strip(),
    )
    db.commit()
    return OtaTargetStatusResponse(
        target_id=tgt.id,
        campaign_id=tgt.campaign_id,
        device_id=tgt.device_id,
        status=tgt.status,
    )


def _ota_targets_list_response(
    db: Session,
    identity: OtaWorkPollIntegration | OtaWorkPollJwtUser,
    *,
    status_filter: str,
    limit: int,
    cursor: str | None,
) -> OtaExecutorWorkListResponse:
    if isinstance(identity, OtaWorkPollIntegration):
        items, next_cursor = list_ota_targets_bearer_scoped(
            db,
            customer_id=identity.customer_id,
            status_filter=status_filter,
            limit=limit,
            cursor=cursor,
        )
    else:
        items, next_cursor = list_executor_work(
            db,
            identity.user,
            status_filter=status_filter,
            limit=limit,
            cursor=cursor,
        )
    return OtaExecutorWorkListResponse(items=[_work_item_read(i) for i in items], next_cursor=next_cursor)


@router.get("/targets", response_model=OtaExecutorWorkListResponse)
def get_ota_targets(
    status_filter: str = Query("command_sent", alias="status"),
    limit: int = Query(100, ge=1, le=500),
    cursor: str | None = Query(None),
    identity: OtaWorkPollIntegration | OtaWorkPollJwtUser = Depends(get_ota_work_poll_identity),
    db: Session = Depends(get_db),
):
    """External OTA worker poll (alias of ``/executor/work``). Use ``Authorization: Bearer`` — JWT or ``OTA_API_BEARER_TOKEN``."""
    return _ota_targets_list_response(db, identity, status_filter=status_filter, limit=limit, cursor=cursor)


@router.get("/executor/work", response_model=OtaExecutorWorkListResponse)
def get_ota_executor_work(
    status_filter: str = Query("command_sent", alias="status"),
    limit: int = Query(100, ge=1, le=500),
    cursor: str | None = Query(None),
    identity: OtaWorkPollIntegration | OtaWorkPollJwtUser = Depends(get_ota_work_poll_identity),
    db: Session = Depends(get_db),
):
    """Option A pull queue: targets in ``command_sent`` for **running** campaigns (JWT + ``ota.executor.read``, or ``OTA_API_BEARER_TOKEN``)."""
    return _ota_targets_list_response(db, identity, status_filter=status_filter, limit=limit, cursor=cursor)


@router.post("/executor/targets/{target_id}/claim", response_model=OtaCampaignTargetRead)
def post_ota_executor_target_claim(
    target_id: uuid.UUID,
    body: OtaTargetClaimRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lease a target: ``command_sent`` → ``claimed`` (``ota.executor.claim``)."""
    tgt = claim_ota_target(
        db,
        user,
        target_id=target_id,
        executor_id=body.executor_id,
        lease_seconds=body.lease_seconds,
    )
    db.commit()
    return OtaCampaignTargetRead.model_validate(tgt)


@router.post("/progress", response_model=OtaCampaignTargetRead)
def post_ota_progress(
    body: OtaProgressReport,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Non-terminal progress only (``ota.executor.progress``)."""
    tgt = report_ota_progress(
        db,
        user,
        target_id=body.target_id,
        phase=body.phase,
        message=body.message,
        payload=body.payload,
    )
    db.commit()
    return OtaCampaignTargetRead.model_validate(tgt)


@router.post("/status", response_model=OtaTargetStatusResponse, status_code=status.HTTP_200_OK)
def post_ota_target_status(
    body: OtaTargetStatusReport,
    user: User = Depends(get_ota_status_actor),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    terminal_override: str | None = Header(None, alias="X-Ota-Terminal-Override"),
):
    """Record terminal OTA target status (``ota.executor.status`` or ``ota.launch``). Requires ``Idempotency-Key``."""
    if not idempotency_key or not idempotency_key.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Idempotency-Key header is required")
    override = (terminal_override or "").strip().lower() in ("1", "true", "yes")
    tgt = complete_ota_target(
        db,
        user,
        target_id=body.target_id,
        new_status=body.status,
        command_id=body.command_id,
        message=body.message,
        ota_external_ref=body.ota_external_ref,
        payload=body.payload,
        idempotency_key=idempotency_key.strip(),
        admin_terminal_override=override,
    )
    db.commit()
    return OtaTargetStatusResponse(
        target_id=tgt.id,
        campaign_id=tgt.campaign_id,
        device_id=tgt.device_id,
        status=tgt.status,
    )


@router.get("/artifacts", response_model=FirmwareArtifactListResponse)
def list_ota_artifacts(
    site_id: uuid.UUID = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = list_firmware_artifacts(db, user, site_id=site_id)
    return FirmwareArtifactListResponse(items=[FirmwareArtifactRead.model_validate(r) for r in rows])


@router.post("/artifacts", response_model=FirmwareArtifactRead, status_code=status.HTTP_201_CREATED)
def post_ota_artifact(
    body: FirmwareArtifactCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = create_firmware_artifact(
        db,
        user,
        site_id=body.site_id,
        artifact_url=body.artifact_url,
        sha256=body.sha256,
        signature=body.signature,
        signature_algorithm=body.signature_algorithm,
        size_bytes=body.size_bytes,
        release_notes=body.release_notes,
    )
    db.commit()
    return FirmwareArtifactRead.model_validate(row)


@router.get("/campaigns", response_model=OtaCampaignListResponse)
def list_ota_campaigns(
    site_id: uuid.UUID | None = Query(None),
    status_filter: str | None = Query(None, alias="status", description="Filter by campaign status"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = list_campaigns_for_user(db, user, site_id=site_id, status_filter=status_filter)
    return OtaCampaignListResponse(items=[OtaCampaignRead.model_validate(r) for r in rows])


@router.post("/campaigns", response_model=OtaCampaignRead, status_code=status.HTTP_201_CREATED)
def create_ota_campaign(
    body: OtaCampaignCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camp = create_campaign(
        db,
        user,
        name=body.name,
        site_id=body.site_id,
        target_firmware_version=body.target_firmware_version,
        target_device_version_id=body.target_device_version_id,
        rollout_strategy=body.rollout_strategy,
        artifact_id=body.artifact_id,
    )
    db.commit()
    return OtaCampaignRead.model_validate(camp)


def _campaign_detail(db: Session, user: User, campaign_id: uuid.UUID) -> OtaCampaign:
    camp = db.scalars(
        select(OtaCampaign)
        .where(OtaCampaign.id == campaign_id, OtaCampaign.customer_id == user.customer_id)
        .options(joinedload(OtaCampaign.targets))
    ).unique().one_or_none()
    if not camp:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OTA campaign not found")
    ensure_campaign_site_readable(db, user, camp)
    return camp


@router.get("/campaigns/{campaign_id}", response_model=OtaCampaignDetailRead)
def get_ota_campaign(
    campaign_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camp = _campaign_detail(db, user, campaign_id)
    base = OtaCampaignRead.model_validate(camp).model_dump()
    sim_url: str | None = None
    status_url: str | None = None
    if camp.simulator_poll_token and camp.site_id:
        if user_has_site_permission(db, user, camp.site_id, "ota.launch"):
            sim_url = build_ota_simulator_poll_url(request, camp.id, camp.simulator_poll_token)
            status_url = build_ota_simulator_status_url(request, camp.id, camp.simulator_poll_token)
    return OtaCampaignDetailRead(
        **base,
        targets=[OtaCampaignTargetRead.model_validate(t) for t in camp.targets],
        simulator_poll_url=sim_url,
        simulator_status_url=status_url,
    )


@router.patch("/campaigns/{campaign_id}", response_model=OtaCampaignRead)
def patch_ota_campaign(
    campaign_id: uuid.UUID,
    body: OtaCampaignUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camp = load_campaign(db, user, campaign_id)
    fs = body.model_fields_set
    camp = update_campaign_draft(
        db,
        user,
        camp,
        name=body.name,
        target_firmware_version=body.target_firmware_version,
        rollout_strategy=body.rollout_strategy,
        target_device_version_id=body.target_device_version_id,
        artifact_id=body.artifact_id if "artifact_id" in fs else _MISSING,
    )
    db.commit()
    return OtaCampaignRead.model_validate(camp)


@router.post("/campaigns/{campaign_id}/targets", response_model=OtaAddTargetsResponse)
def post_ota_campaign_targets(
    campaign_id: uuid.UUID,
    body: OtaAddTargetsRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camp = load_campaign(db, user, campaign_id)
    added = add_targets(db, user, camp, body.device_ids)
    db.commit()
    return OtaAddTargetsResponse(added=[OtaCampaignTargetRead.model_validate(t) for t in added])


@router.delete("/campaigns/{campaign_id}/targets/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ota_campaign_target(
    campaign_id: uuid.UUID,
    target_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camp = load_campaign(db, user, campaign_id)
    remove_target(db, user, camp, target_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/campaigns/{campaign_id}/submit", response_model=OtaCampaignRead)
def post_ota_campaign_submit(
    campaign_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camp = load_campaign(db, user, campaign_id)
    camp = submit_for_approval(db, user, camp)
    db.commit()
    return OtaCampaignRead.model_validate(camp)


@router.post("/campaigns/{campaign_id}/approve", response_model=OtaCampaignRead)
def post_ota_campaign_approve(
    campaign_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camp = load_campaign(db, user, campaign_id)
    camp = approve_campaign(db, user, camp)
    db.commit()
    return OtaCampaignRead.model_validate(camp)


@router.post("/campaigns/{campaign_id}/launch", response_model=OtaCampaignRead)
def post_ota_campaign_launch(
    campaign_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camp = load_campaign(db, user, campaign_id)
    camp = launch_campaign(db, user, camp)
    db.commit()
    return OtaCampaignRead.model_validate(camp)


@router.post("/campaigns/{campaign_id}/pause", response_model=OtaCampaignRead)
def post_ota_campaign_pause(
    campaign_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camp = load_campaign(db, user, campaign_id)
    camp = pause_campaign(db, user, camp)
    db.commit()
    return OtaCampaignRead.model_validate(camp)


@router.post("/campaigns/{campaign_id}/resume", response_model=OtaCampaignRead)
def post_ota_campaign_resume(
    campaign_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camp = load_campaign(db, user, campaign_id)
    camp = resume_campaign(db, user, camp)
    db.commit()
    return OtaCampaignRead.model_validate(camp)


@router.post("/campaigns/{campaign_id}/cancel", response_model=OtaCampaignRead)
def post_ota_campaign_cancel(
    campaign_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camp = load_campaign(db, user, campaign_id)
    camp = cancel_campaign(db, user, camp)
    db.commit()
    return OtaCampaignRead.model_validate(camp)


@router.get("/campaigns/{campaign_id}/events", response_model=OtaEventListResponse)
def get_ota_campaign_events(
    campaign_id: uuid.UUID,
    limit: int = Query(200, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camp = load_campaign(db, user, campaign_id)
    ensure_campaign_site_readable(db, user, camp)
    rows = list_events(db, user, camp, limit=limit)
    return OtaEventListResponse(items=[OtaEventRead.model_validate(e) for e in rows])
