"""Environment flags for worker processes (ingest, scrubber, …)."""

from __future__ import annotations

import os


def _truthy(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).lower() in ("1", "true", "yes")


class WorkerSettings:
    @property
    def KAFKA_EMIT_SCRUBBER_INPUT(self) -> bool:
        # Match docker-compose default: without this, raw.ingest is never forwarded to scrubber.input
        # and worker-scrubber never inserts data_objects.
        return _truthy("KAFKA_EMIT_SCRUBBER_INPUT", "true")


settings = WorkerSettings()
