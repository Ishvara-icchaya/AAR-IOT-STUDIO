"""Phase 1: restart is a logged no-op; future hooks can signal orchestrator."""

from __future__ import annotations

import logging
import uuid

log = logging.getLogger(__name__)


def request_platform_restart(*, customer_id: uuid.UUID, user_id: uuid.UUID) -> str:
    log.info(
        "ports_restart_requested customer_id=%s user_id=%s (no container restart in Phase 1)",
        customer_id,
        user_id,
    )
    return (
        "Restart request recorded. Automatic service restart is not enabled in Phase 1; "
        "redeploy or restart containers manually if you changed host networking."
    )
