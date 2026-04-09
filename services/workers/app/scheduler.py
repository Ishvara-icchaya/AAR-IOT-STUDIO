"""scheduler — polling + scheduled jobs (scaffold)."""

import logging
import os
import time

import redis

from app.logging_setup import configure_logging
from app.mask import redact_url
from app.pipeline import emit
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)


def main() -> None:
    log.debug("scheduler main() starting")
    interval_s = 30
    emit(
        log,
        component="scheduler",
        action="lifecycle",
        status="started",
        polling_interval_seconds=interval_s,
        detail="device_polling_kafka_hooks_not_implemented",
    )
    url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    log.debug("scheduler REDIS_URL=%s", redact_url(url))
    try:
        r = redis.from_url(url)
        r.ping()
        emit(
            log,
            component="scheduler",
            action="redis.connect",
            status="ok",
            redis_url=redact_url(url),
        )
        log.info("scheduler connected to redis")
        start_worker_heartbeat("scheduler")
    except redis.RedisError as e:
        emit(
            log,
            component="scheduler",
            action="redis.connect",
            status="error",
            redis_url=redact_url(url),
            error=str(e)[:500],
        )
        log.warning("redis unavailable: %s", e)
    log.info("scheduler tick loop (hook device polling + Kafka produce later)")
    tick = 0
    while True:
        time.sleep(interval_s)
        tick += 1
        log.debug("scheduler tick=%s", tick)


if __name__ == "__main__":
    main()
