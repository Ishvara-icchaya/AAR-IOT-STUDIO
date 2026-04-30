"""Assemble trend window reads: auth (site-scoped) + Redis contract keys."""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.endpoint import Endpoint
from app.models.resolved_device import ResolvedDevice
from app.schemas.trends import TrendBucketPoint, TrendsWindowResponse
from app.services.trend_redis_contract import (
    load_window_series_json,
    redis_client,
    window_key_for_scope,
)

MAX_METRICS = 24


def _parse_as_of(raw: str | None) -> datetime:
    if not raw or not raw.strip():
        return datetime.now(timezone.utc)
    s = raw.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _normalize_bucket(raw: dict[str, Any]) -> TrendBucketPoint | None:
    ts = raw.get("ts") or raw.get("t") or raw.get("bucket_start")
    if not isinstance(ts, str) or not ts.strip():
        return None
    n_raw = raw.get("n")
    n = int(n_raw) if isinstance(n_raw, (int, float)) and not isinstance(n_raw, bool) else None
    if n is None and n_raw is not None:
        try:
            n = int(n_raw)
        except (TypeError, ValueError):
            n = None

    def f(name: str) -> float | None:
        v = raw.get(name)
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    std = f("stddev")
    if std is None:
        std = f("std")

    avg = f("avg")
    if avg is None and n is not None and n > 0:
        s = f("sum")
        if s is not None:
            avg = float(s) / float(n)

    if std is None and n is not None and n >= 2:
        sumsq_v = f("sumsq")
        s = f("sum")
        if sumsq_v is not None and s is not None and avg is not None:
            variance = (float(sumsq_v) / float(n)) - (float(avg) ** 2)
            std = math.sqrt(max(variance, 0.0))

    partial = raw.get("is_partial")
    if partial is None:
        partial = raw.get("partial")
    is_partial = bool(partial) if partial is not None else False

    return TrendBucketPoint(
        ts=ts.strip(),
        avg=avg,
        min=f("min"),
        max=f("max"),
        stddev=None if n is None or n < 2 else std,
        n=n,
        is_partial=is_partial,
    )


def _assert_site_access_resolved_device(db: Session, *, customer_id: uuid.UUID, site_id: uuid.UUID, entity_id: uuid.UUID) -> None:
    rd = db.get(ResolvedDevice, entity_id)
    if not rd or rd.customer_id != customer_id:
        raise LookupError("resolved_device")
    if rd.site_id != site_id:
        raise PermissionError("resolved_device site mismatch")


def _assert_site_access_endpoint(db: Session, *, customer_id: uuid.UUID, site_id: uuid.UUID, entity_id: uuid.UUID) -> None:
    ep = db.get(Endpoint, entity_id)
    if not ep or ep.customer_id != customer_id:
        raise LookupError("endpoint")
    if ep.site_id != site_id:
        raise PermissionError("endpoint site mismatch")


def build_trends_window_response(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    scope: str,
    entity_id: uuid.UUID,
    metrics: list[str],
    window: str,
    bucket: str,
    as_of_raw: str | None,
) -> TrendsWindowResponse:
    if bucket != "5m":
        raise ValueError("only bucket=5m is supported")
    if window not in ("1h", "24h"):
        raise ValueError("window must be 1h or 24h")
    scope_l = scope.strip().lower()
    if scope_l not in ("resolved_device", "endpoint", "site"):
        raise ValueError("invalid scope")

    if scope_l == "site":
        if entity_id != site_id:
            raise PermissionError("site entityId must match site_id")
    elif scope_l == "resolved_device":
        _assert_site_access_resolved_device(db, customer_id=customer_id, site_id=site_id, entity_id=entity_id)
    else:
        _assert_site_access_endpoint(db, customer_id=customer_id, site_id=site_id, entity_id=entity_id)

    as_of = _parse_as_of(as_of_raw)
    as_of_iso = as_of.isoformat().replace("+00:00", "Z")

    clean_metrics = [m.strip() for m in metrics if m.strip()][:MAX_METRICS]
    entity_s = str(entity_id)
    series: dict[str, list[TrendBucketPoint]] = {}

    r = redis_client()
    try:
        if r is None:
            for mk in clean_metrics:
                series[mk] = []
        else:
            for mk in clean_metrics:
                key = window_key_for_scope(scope_l, entity_s, mk, window)
                raw_list = load_window_series_json(r, key) or []
                out: list[TrendBucketPoint] = []
                for item in raw_list:
                    pt = _normalize_bucket(item)
                    if pt:
                        out.append(pt)
                series[mk] = out
    finally:
        if r is not None:
            try:
                r.close()
            except Exception:
                pass

    return TrendsWindowResponse(
        scope=scope_l,  # type: ignore[arg-type]
        entity_id=entity_s,
        window=window,  # type: ignore[arg-type]
        bucket="5m",
        as_of=as_of_iso,
        series=series,
    )
