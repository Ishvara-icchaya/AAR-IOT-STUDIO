from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.redis_sync import get_redis
from app.models.device import Device

STATE_WAITING = "waiting_for_first_payload"
STATE_ONLINE = "online"
STATE_LATE = "late"
STATE_OFFLINE = "offline"

_CUSTOMER_KEY = "aar:liveness:v1:customer:{cid}"


def customer_liveness_counts(db: Session, *, customer_id: uuid.UUID) -> dict[str, int]:
    out = {
        STATE_ONLINE: 0,
        STATE_LATE: 0,
        STATE_OFFLINE: 0,
        STATE_WAITING: 0,
    }
    r = get_redis()
    if r:
        try:
            raw = r.hgetall(_CUSTOMER_KEY.format(cid=customer_id))
            if raw:
                for k in out:
                    out[k] = int(raw.get(k) or 0)
                return out
        except Exception:
            pass

    rows = db.execute(
        select(Device.current_liveness_state, func.count())
        .where(Device.customer_id == customer_id)
        .group_by(Device.current_liveness_state)
    ).all()
    for st, cnt in rows:
        key = str(st or STATE_WAITING)
        if key in out:
            out[key] = int(cnt or 0)
    return out
