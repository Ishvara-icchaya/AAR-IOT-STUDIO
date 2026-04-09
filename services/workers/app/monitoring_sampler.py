"""Optional process sampler for future Redis keys monitoring:resource:* (Phase 2).

Run as a dedicated container or cron if you want per-service CPU/memory on the host.
This module is intentionally minimal for Phase 1.

Future: mirror heartbeats to spec-style keys, e.g.
``monitoring:service:last_seen:{service}``, alongside ``aar:worker:heartbeat:{service}``.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def main() -> None:
    log.info("monitoring_sampler: no-op in Phase 1 (extend with psutil + Redis writes)")


if __name__ == "__main__":
    main()
