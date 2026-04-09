"""Streak + cooldown before emitting publish delivery failure alerts."""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from app.alert_emit import _redis_client

log = logging.getLogger(__name__)

_STREAK = max(1, int(os.environ.get("PUBLISH_FAIL_ALERT_STREAK", "3")))
_COOLDOWN = max(60, int(os.environ.get("PUBLISH_FAIL_ALERT_COOLDOWN_SEC", "900")))


def redis_for_publish_policy() -> Any | None:
    return _redis_client()


def publish_success_clear_streak(r: Any | None, service_id: str) -> None:
    if not r:
        return
    try:
        r.delete(f"publish:fail:streak:{service_id}")
    except Exception:
        log.debug("publish streak clear failed", exc_info=True)


def should_emit_publish_failure_alert(r: Any | None, service_id: str) -> bool:
    """After incrementing streak caller-side, or we incr here."""
    if not r:
        return True
    try:
        streak = int(r.incr(f"publish:fail:streak:{service_id}"))
        r.expire(f"publish:fail:streak:{service_id}", 86400)
        if streak < _STREAK:
            return False
        now = time.time()
        raw = r.get(f"publish:fail:cooldown:{service_id}")
        if raw is not None:
            try:
                if float(raw) > now:
                    return False
            except ValueError:
                pass
        r.set(f"publish:fail:cooldown:{service_id}", str(now + _COOLDOWN), ex=_COOLDOWN + 120)
        r.delete(f"publish:fail:streak:{service_id}")
        return True
    except Exception:
        log.debug("publish failure policy redis failed", exc_info=True)
        return True
