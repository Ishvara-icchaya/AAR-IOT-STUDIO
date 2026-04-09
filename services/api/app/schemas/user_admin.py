import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = None
    role: Literal["admin", "operator"] = "operator"
    site_ids: list[uuid.UUID] = Field(default_factory=list)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    email: str
    full_name: str | None
    is_active: bool
    role: str
    site_ids: list[uuid.UUID] = Field(default_factory=list)
