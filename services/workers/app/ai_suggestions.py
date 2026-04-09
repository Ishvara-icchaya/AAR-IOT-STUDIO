"""Optional background job to warm Enterprise AI suggestion cache (Phase 2).

Suggestions are generated inline on GET /api/v1/ai/suggestions today; a worker can
call the same builders periodically per customer if needed.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def main() -> None:
    log.info("ai_suggestions worker: no-op in Phase 1")


if __name__ == "__main__":
    main()
