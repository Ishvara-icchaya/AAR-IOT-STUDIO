"""Operational lineage status + recommendations (single source of truth for evaluation logic).

Distinct from ``devices.operational_status`` / ``device_endpoints.operational_status`` lifecycle
columns (active / inactive / archived).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

FootprintOperationalStatus = Literal["ready", "stale", "incomplete", "broken", "unknown"]
FootprintRecommendationCode = Literal[
    "HEALTHY",
    "NO_RECENT_INGEST",
    "NO_INITIAL_INGEST",
    "NO_ENDPOINT",
    "NOT_ACTIVATED",
    "NO_RESOLVED_DEVICE",
    "SCRUBBER_NOT_CONFIGURED",
    "PIPELINE_ERROR",
    "NO_DASHBOARD_ASSOCIATION",
]

BOOTSTRAP_WINDOW_MINUTES = 15
DEFAULT_EXPECTED_FREQUENCY_SEC = 60


@dataclass(frozen=True)
class OperationalFootprintContext:
    """Inputs required for ``evaluate_status`` / ``derive_recommendation`` (no ORM types)."""

    device_id: str
    created_at: datetime
    endpoint_id: str | None
    activation_status: str | None
    resolved_device_id: str | None
    last_ingested_at: datetime | None
    expected_frequency_sec: int
    pipeline_error: bool
    scrubber_configured: bool
    dashboard_association_count: int


def _age_minutes(since: datetime, now: datetime) -> float:
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return (now - since).total_seconds() / 60.0


def ingestion_expected(ctx: OperationalFootprintContext) -> bool:
    return ctx.endpoint_id is not None and (ctx.activation_status or "").strip().lower() == "active"


def is_unknown(ctx: OperationalFootprintContext, now: datetime) -> bool:
    return ctx.last_ingested_at is None and _age_minutes(ctx.created_at, now) < BOOTSTRAP_WINDOW_MINUTES


def is_incomplete(ctx: OperationalFootprintContext, now: datetime) -> bool:
    if ctx.endpoint_id is None:
        return True
    if (ctx.activation_status or "").strip().lower() != "active":
        return True
    age_created = _age_minutes(ctx.created_at, now)
    if ctx.resolved_device_id is None and age_created >= BOOTSTRAP_WINDOW_MINUTES:
        return True
    if ingestion_expected(ctx) and ctx.last_ingested_at is None and age_created >= BOOTSTRAP_WINDOW_MINUTES:
        return True
    if (
        ingestion_expected(ctx)
        and ctx.last_ingested_at is not None
        and not ctx.scrubber_configured
        and age_created >= BOOTSTRAP_WINDOW_MINUTES
    ):
        return True
    return False


def is_broken(ctx: OperationalFootprintContext) -> bool:
    return ctx.pipeline_error


def is_stale(ctx: OperationalFootprintContext, now: datetime) -> bool:
    if ctx.last_ingested_at is None:
        return False
    freq = ctx.expected_frequency_sec if ctx.expected_frequency_sec > 0 else DEFAULT_EXPECTED_FREQUENCY_SEC
    threshold_sec = max(3 * freq, 60)
    li = ctx.last_ingested_at
    if li.tzinfo is None:
        li = li.replace(tzinfo=timezone.utc)
    n = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    age_sec = (n - li).total_seconds()
    return age_sec > threshold_sec


def evaluate_status(ctx: OperationalFootprintContext, now: datetime | None = None) -> FootprintOperationalStatus:
    """Evaluate conditions in precedence order; assign the first state whose predicate is true."""
    n = now or datetime.now(timezone.utc)
    if is_unknown(ctx, n):
        return "unknown"
    if is_incomplete(ctx, n):
        return "incomplete"
    if is_broken(ctx):
        return "broken"
    if is_stale(ctx, n):
        return "stale"
    return "ready"


def _incomplete_primary_code(ctx: OperationalFootprintContext, now: datetime) -> FootprintRecommendationCode:
    if ctx.endpoint_id is None:
        return "NO_ENDPOINT"
    if (ctx.activation_status or "").strip().lower() != "active":
        return "NOT_ACTIVATED"
    if ingestion_expected(ctx) and ctx.last_ingested_at is None and _age_minutes(ctx.created_at, now) >= BOOTSTRAP_WINDOW_MINUTES:
        return "NO_INITIAL_INGEST"
    if ctx.resolved_device_id is None and _age_minutes(ctx.created_at, now) >= BOOTSTRAP_WINDOW_MINUTES:
        return "NO_RESOLVED_DEVICE"
    if not ctx.scrubber_configured:
        return "SCRUBBER_NOT_CONFIGURED"
    return "NOT_ACTIVATED"


_REC_MESSAGES: dict[FootprintRecommendationCode, str] = {
    "HEALTHY": "Device fully operational",
    "NO_RECENT_INGEST": "No recent ingest within freshness window",
    "NO_INITIAL_INGEST": "No ingest observed after bootstrap window",
    "NO_ENDPOINT": "No endpoint configured for this device",
    "NOT_ACTIVATED": "Endpoint is not active",
    "NO_RESOLVED_DEVICE": "Resolved device identity not linked",
    "SCRUBBER_NOT_CONFIGURED": "Scrubber pipeline not configured",
    "PIPELINE_ERROR": "Pipeline reported an error",
    "NO_DASHBOARD_ASSOCIATION": "Not referenced by any dashboard",
}


def derive_recommendation(
    ctx: OperationalFootprintContext,
    status: FootprintOperationalStatus,
    now: datetime | None = None,
) -> tuple[FootprintRecommendationCode, str]:
    """Return (code, short message). Recommendation follows derived status (v1)."""
    n = now or datetime.now(timezone.utc)
    if status == "unknown":
        # No separate enum member in v1 contract; message distinguishes bootstrap.
        return "NO_INITIAL_INGEST", "Awaiting first ingest (bootstrap window)"
    if status == "incomplete":
        code = _incomplete_primary_code(ctx, n)
        return code, _REC_MESSAGES[code]
    if status == "broken":
        return "PIPELINE_ERROR", _REC_MESSAGES["PIPELINE_ERROR"]
    if status == "stale":
        return "NO_RECENT_INGEST", _REC_MESSAGES["NO_RECENT_INGEST"]
    # ready
    if ctx.dashboard_association_count <= 0:
        return "NO_DASHBOARD_ASSOCIATION", _REC_MESSAGES["NO_DASHBOARD_ASSOCIATION"]
    return "HEALTHY", _REC_MESSAGES["HEALTHY"]
