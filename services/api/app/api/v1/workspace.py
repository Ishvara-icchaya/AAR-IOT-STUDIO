import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.workspace_message import WorkspaceMessage
from app.schemas.workspace import (
    WorkspaceMessageCreateResponse,
    WorkspaceMessageRead,
    WorkspaceMessagesListResponse,
    WorkspaceRecipientRead,
)

router = APIRouter()
log = logging.getLogger(__name__)

_MAX_ATTACHMENT_BYTES = 1_500_000
_ALLOWED_CATEGORIES = frozenset({"lineage_share", "general"})


def _same_tenant(db: Session, user_id: uuid.UUID, customer_id: uuid.UUID) -> User | None:
    return db.execute(
        select(User).where(
            User.id == user_id,
            User.customer_id == customer_id,
            User.is_active.is_(True),
            User.account_status.in_(("active", "invited")),
        )
    ).scalar_one_or_none()


@router.get("/recipients", response_model=list[WorkspaceRecipientRead])
def list_workspace_recipients(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Users in the same tenant (for Send-to picker). Excludes the current user."""
    rows = db.scalars(
        select(User)
        .where(
            User.customer_id == user.customer_id,
            User.id != user.id,
            User.is_active.is_(True),
            User.account_status.in_(("active", "invited")),
        )
        .order_by(User.email)
    ).all()
    return [WorkspaceRecipientRead(id=u.id, email=u.email, full_name=u.full_name) for u in rows]


@router.get("/messages", response_model=WorkspaceMessagesListResponse)
def list_workspace_messages(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(WorkspaceMessage)
        .options(joinedload(WorkspaceMessage.sender))
        .where(WorkspaceMessage.recipient_id == user.id)
        .order_by(WorkspaceMessage.created_at.desc())
        .limit(200)
    ).unique().all()
    items: list[WorkspaceMessageRead] = []
    for m in rows:
        snd = m.sender
        items.append(
            WorkspaceMessageRead(
                id=m.id,
                category=m.category,
                title=m.title,
                body=m.body,
                sender_email=snd.email if snd else "—",
                sender_name=snd.full_name if snd else None,
                has_attachment=bool(m.attachment_data),
                attachment_filename=m.attachment_filename,
                attachment_mime=m.attachment_mime,
                read_at=m.read_at,
                created_at=m.created_at,
            )
        )
    return WorkspaceMessagesListResponse(items=items)


@router.post("/messages", response_model=WorkspaceMessageCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace_message(
    recipient_id: uuid.UUID = Form(...),
    category: str = Form(...),
    title: str = Form(...),
    body: str | None = Form(None),
    file: UploadFile | None = File(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cat = (category or "").strip().lower()
    if cat not in _ALLOWED_CATEGORIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"category must be one of: {', '.join(sorted(_ALLOWED_CATEGORIES))}")

    if recipient_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot send a workspace message to yourself")

    rcpt = _same_tenant(db, recipient_id, user.customer_id)
    if not rcpt:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown or inactive recipient in this tenant")

    att_name: str | None = None
    att_mime: str | None = None
    att_data: bytes | None = None
    if file and file.filename:
        raw = await file.read()
        if len(raw) > _MAX_ATTACHMENT_BYTES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Attachment exceeds {_MAX_ATTACHMENT_BYTES} bytes")
        att_name = file.filename[:255]
        att_mime = (file.content_type or "application/octet-stream")[:128]
        att_data = raw

    msg = WorkspaceMessage(
        id=uuid.uuid4(),
        customer_id=user.customer_id,
        sender_id=user.id,
        recipient_id=recipient_id,
        category=cat,
        title=title.strip()[:512] or "Workspace message",
        body=(body.strip() if body else None) or None,
        attachment_filename=att_name,
        attachment_mime=att_mime,
        attachment_data=att_data,
    )
    db.add(msg)
    db.commit()
    log.info("workspace message created id=%s category=%s recipient=%s", msg.id, cat, recipient_id)
    return WorkspaceMessageCreateResponse(id=msg.id)


@router.get("/messages/{message_id}/attachment")
def download_workspace_attachment(
    message_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.get(WorkspaceMessage, message_id)
    if not m or m.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    if m.recipient_id != user.id and m.sender_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
    if not m.attachment_data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No attachment")

    if m.recipient_id == user.id and m.read_at is None:
        m.read_at = datetime.now(timezone.utc)
        db.add(m)
        db.commit()

    fname = (m.attachment_filename or "attachment").replace("\r", "").replace("\n", "")
    mime = m.attachment_mime or "application/octet-stream"
    return Response(
        content=m.attachment_data,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
