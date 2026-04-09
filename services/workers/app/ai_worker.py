"""worker-ai — background AI jobs (scaffold)."""

import logging
import time

from app.logging_setup import configure_logging
from app.pipeline import emit
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)


def main() -> None:
    log.debug("worker-ai main() starting")
    emit(
        log,
        component="worker-ai",
        action="lifecycle",
        status="started",
        detail="idle_loop_hook_kafka_ollama_later",
    )
    emit(
        log,
        component="worker-ai",
        action="query_planning",
        status="pending",
        detail="no_planner_implemented",
    )
    log.info("worker-ai idle loop (hook Kafka/Redis + Ollama later)")
    start_worker_heartbeat("worker-ai")
    n = 0
    while True:
        time.sleep(60)
        n += 1
        log.debug("worker-ai heartbeat tick=%s", n)


if __name__ == "__main__":
    main()
