"""workflows.lifecycle_status canonical values (column renamed from status)."""

WORKFLOW_LIFECYCLE = [
    "draft",
    "validated",
    "published",
    "stopped",
    "failed",
]

WF_DRAFT = "draft"
WF_VALIDATED = "validated"
WF_PUBLISHED = "published"
WF_STOPPED = "stopped"
WF_FAILED = "failed"


def is_published_workflow(lifecycle: str | None, is_published_flag: bool | None = None) -> bool:
    if is_published_flag is True:
        return True
    return (lifecycle or "").lower() == WF_PUBLISHED
