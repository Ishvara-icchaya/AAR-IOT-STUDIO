import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class WorkspaceRecipientRead(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None = None


class WorkspaceMessageRead(BaseModel):
    id: uuid.UUID
    category: str
    title: str
    body: str | None = None
    sender_email: str
    sender_name: str | None = None
    has_attachment: bool = False
    attachment_filename: str | None = None
    attachment_mime: str | None = None
    read_at: datetime | None = None
    created_at: datetime


class WorkspaceMessageCreateResponse(BaseModel):
    id: uuid.UUID
    ok: bool = True


class WorkspaceMessagesListResponse(BaseModel):
    items: list[WorkspaceMessageRead] = Field(default_factory=list)
