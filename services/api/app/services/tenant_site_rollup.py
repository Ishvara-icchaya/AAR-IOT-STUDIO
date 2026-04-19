"""Redis-backed site object counts with DB warm fallback (Phase D)."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.redis_sync import get_redis
from app.models.data_object import DataObject
from app.models.site import Site
from app.models.workflow_result_object import WorkflowResultObject
from app.schemas.dashboard import EnterpriseSiteObjectCountRow, EnterpriseSiteObjectCountsResponse

log = logging.getLogger(__name__)

_SITE_HASH = "aar:rollup:v1:site:{sid}"
_ZSET = "aar:rollup:v1:customer:{cid}:sites_by_total"


def _warm_customer_rollups(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed: list[uuid.UUID] | None,
) -> None:
    r = get_redis()
    if not r:
        return
    do_sq = (
        select(
            DataObject.site_id.label("site_id"),
            func.count().label("do_cnt"),
        )
        .where(DataObject.customer_id == customer_id)
        .group_by(DataObject.site_id)
    ).subquery()

    ro_sq = (
        select(
            WorkflowResultObject.site_id.label("site_id"),
            func.count().label("ro_cnt"),
        )
        .where(WorkflowResultObject.customer_id == customer_id)
        .group_by(WorkflowResultObject.site_id)
    ).subquery()

    do_cnt = func.coalesce(do_sq.c.do_cnt, 0)
    ro_cnt = func.coalesce(ro_sq.c.ro_cnt, 0)
    total_cnt = do_cnt + ro_cnt

    site_filter = [Site.customer_id == customer_id]
    if allowed is not None:
        site_filter.append(Site.id.in_(allowed))

    stmt = (
        select(
            Site.id,
            do_cnt.label("doc"),
            ro_cnt.label("roc"),
            total_cnt.label("tot"),
        )
        .select_from(Site)
        .outerjoin(do_sq, Site.id == do_sq.c.site_id)
        .outerjoin(ro_sq, Site.id == ro_sq.c.site_id)
        .where(*site_filter)
    )
    rows = db.execute(stmt).all()
    zkey = _ZSET.format(cid=customer_id)
    pipe = r.pipeline()
    for sid, doc, roc, tot in rows:
        s = str(sid)
        pipe.hset(
            _SITE_HASH.format(sid=s),
            mapping={"do": int(doc or 0), "ro": int(roc or 0)},
        )
        pipe.zadd(zkey, {s: float(tot or 0)})
    try:
        pipe.execute()
    except Exception:
        log.debug("rollup warm pipeline failed", exc_info=True)


def site_object_counts_with_redis(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed: list[uuid.UUID] | None,
    page: int,
    page_size: int,
) -> EnterpriseSiteObjectCountsResponse | None:
    """Return paginated site counts from Redis if possible; otherwise ``None`` (caller uses DB)."""
    r = get_redis()
    if not r:
        return None
    zkey = _ZSET.format(cid=customer_id)
    try:
        if int(r.zcard(zkey) or 0) == 0:
            _warm_customer_rollups(db, customer_id=customer_id, allowed=allowed)
        raw = r.zrevrange(zkey, 0, -1, withscores=True)
    except Exception:
        log.debug("rollup redis read failed", exc_info=True)
        return None

    if not raw:
        return None

    pairs: list[tuple[str, float]] = [(m, float(s)) for m, s in raw]
    if allowed is not None:
        allow_s = {str(x) for x in allowed}
        pairs = [(m, sc) for m, sc in pairs if m in allow_s]

    total_rows = len(pairs)
    start = (page - 1) * page_size
    slice_pairs = pairs[start : start + page_size]

    if not slice_pairs:
        return EnterpriseSiteObjectCountsResponse(
            items=[], total=total_rows, page=page, page_size=page_size
        )

    pipe = r.pipeline()
    for sid_str, _sc in slice_pairs:
        pipe.hgetall(_SITE_HASH.format(sid=sid_str))
    try:
        hash_rows = pipe.execute()
    except Exception:
        log.debug("rollup hgetall batch failed", exc_info=True)
        return None

    ids = [uuid.UUID(m) for m, _ in slice_pairs]
    sites = db.execute(select(Site.id, Site.name).where(Site.id.in_(ids))).all()
    name_by_id: dict[uuid.UUID, str] = {row[0]: row[1] for row in sites}

    items: list[EnterpriseSiteObjectCountRow] = []
    for (sid_str, _sc), h in zip(slice_pairs, hash_rows):
        sid = uuid.UUID(sid_str)
        doc = int((h or {}).get("do") or 0)
        roc = int((h or {}).get("ro") or 0)
        items.append(
            EnterpriseSiteObjectCountRow(
                site_id=sid,
                site_name=name_by_id.get(sid, sid_str),
                data_object_count=doc,
                result_object_count=roc,
                total_count=doc + roc,
            )
        )

    return EnterpriseSiteObjectCountsResponse(
        items=items,
        total=total_rows,
        page=page,
        page_size=page_size,
    )
