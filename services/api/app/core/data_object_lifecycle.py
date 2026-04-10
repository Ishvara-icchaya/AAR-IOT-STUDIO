"""data_objects.lifecycle_status canonical values."""

DATA_OBJECT_LIFECYCLE = [
    "draft",
    "compiled",
    "published",
    "inactive",
    "archived",
    "failed",
]

DATA_DRAFT = "draft"
DATA_COMPILED = "compiled"
DATA_PUBLISHED = "published"
DATA_INACTIVE = "inactive"
DATA_ARCHIVED = "archived"
DATA_FAILED = "failed"


def is_published_lifecycle(status: str | None) -> bool:
    return (status or "").lower() == DATA_PUBLISHED
