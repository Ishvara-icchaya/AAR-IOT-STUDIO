"""CLI: rebuild Redis trend series from Timescale ``trend_metric_bucket``.

Usage (from ``services/api`` with deps installed)::

    PYTHONPATH=. python -m app.commands.rebuild_trend_redis_cache --site-id <UUID> [--hours 26]
"""

from __future__ import annotations

import argparse
import logging
import sys
import uuid

from app.core.logging_config import configure_logging
from app.services.trend_redis_rebuild import rebuild_redis_trends_from_timescale

log = logging.getLogger(__name__)


def main() -> int:
    configure_logging()
    p = argparse.ArgumentParser(description="Rebuild Redis trend keys from Timescale trend_metric_bucket.")
    p.add_argument("--site-id", required=True, help="Site UUID (filters Timescale rows).")
    p.add_argument("--hours", type=int, default=26, help="Lookback hours (default 26, max 168).")
    args = p.parse_args()
    try:
        sid = uuid.UUID(str(args.site_id).strip())
    except ValueError:
        log.error("Invalid --site-id")
        return 2
    n = rebuild_redis_trends_from_timescale(site_id=sid, hours=args.hours)
    log.info("Rebuild complete: %s series keys written for site=%s", n, sid)
    print(n)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
