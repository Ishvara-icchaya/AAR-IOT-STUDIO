"""Poll HTTP(S) endpoints from device_endpoints (rest_mode=polling) → raw ingest path."""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

import httpx
import psycopg2

from app.ingest_archive import db_url, ingest_json_payload_for_device
from app.ingress_redis_metrics import (
    record_ingest_error,
    record_ingest_success,
    record_poll_attempt,
    record_quality_event,
    set_adapter_status,
    write_adapter_boot,
)
from app.log_redact import safe_url_for_log
from app.logging_setup import configure_logging
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)


def _load_poll_rows() -> list[tuple[uuid.UUID, uuid.UUID, dict[str, Any], int]]:
    conn = psycopg2.connect(db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, device_id::text, config, polling_interval_seconds
                FROM device_endpoints
                WHERE is_active = true AND protocol IN ('http', 'https')
                """
            )
            out: list[tuple[uuid.UUID, uuid.UUID, dict[str, Any], int]] = []
            for eid_s, did_s, cfg, poll_col in cur.fetchall():
                c = cfg if isinstance(cfg, dict) else {}
                if c.get("rest_mode") != "polling":
                    continue
                url = (c.get("polling_url") or "").strip()
                if not url:
                    continue
                try:
                    psec = int(poll_col) if poll_col is not None else 60
                except (TypeError, ValueError):
                    psec = 60
                out.append((uuid.UUID(eid_s), uuid.UUID(did_s), c, psec))
            return out
    finally:
        conn.close()


def _build_headers(cfg: dict[str, Any]) -> dict[str, str]:
    headers: dict[str, str] = {}
    hj = cfg.get("headers_json")
    if isinstance(hj, str) and hj.strip():
        try:
            parsed = json.loads(hj)
            if isinstance(parsed, dict):
                headers = {str(k): str(v) for k, v in parsed.items()}
        except json.JSONDecodeError:
            log.warning("rest_poller bad headers_json")
    auth_type = cfg.get("auth_type")
    if auth_type == "bearer":
        tok = cfg.get("auth_header_value") or ""
        headers["Authorization"] = f"Bearer {tok}"
    elif auth_type == "header":
        name = (cfg.get("auth_header_name") or "Authorization").strip()
        headers[name] = str(cfg.get("auth_header_value") or "")
    return headers


def _poll_interval_seconds(cfg: dict[str, Any], column_interval: int) -> int:
    raw = cfg.get("polling_interval_seconds")
    try:
        from_cfg = int(raw) if raw is not None else column_interval
    except (TypeError, ValueError):
        from_cfg = column_interval
    return max(5, from_cfg)


def _poll_one(endpoint_id: uuid.UUID, device_id: uuid.UUID, cfg: dict[str, Any]) -> None:
    url = (cfg.get("polling_url") or "").strip()
    method = (cfg.get("method") or "GET").strip().upper() or "GET"
    timeout_s = cfg.get("timeout_seconds")
    try:
        timeout = float(timeout_s) if timeout_s is not None else 30.0
    except (TypeError, ValueError):
        timeout = 30.0
    timeout = max(1.0, min(timeout, 300.0))
    headers = _build_headers(cfg)

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.request(method, url, headers=headers)
    except httpx.HTTPError as e:
        record_quality_event("rest_poller", "transport_error")
        record_poll_attempt("rest_poller", ok=False)
        record_ingest_error("rest_poller", f"transport:{e!s}"[:200])
        log.warning(
            "rest_poller device=%s url=%s transport error=%s",
            device_id,
            safe_url_for_log(url),
            e,
        )
        return

    record_poll_attempt("rest_poller", ok=resp.is_success)
    if not resp.is_success:
        record_quality_event("rest_poller", f"http_{resp.status_code}")
        record_ingest_error(
            "rest_poller",
            f"http_{resp.status_code}:{resp.text[:120]!s}",
        )
        log.warning(
            "rest_poller device=%s url=%s status=%s",
            device_id,
            safe_url_for_log(url),
            resp.status_code,
        )
        return

    body = resp.content
    if not body:
        record_quality_event("rest_poller", "empty_body")
        record_ingest_error("rest_poller", "empty body")
        return
    try:
        text = body.decode("utf-8")
        data = json.loads(text)
    except UnicodeDecodeError:
        record_quality_event("rest_poller", "invalid_utf8")
        record_ingest_error("rest_poller", "invalid utf-8")
        return
    except json.JSONDecodeError:
        record_quality_event("rest_poller", "invalid_json")
        record_ingest_error("rest_poller", "invalid json")
        return
    if not isinstance(data, dict):
        record_quality_event("rest_poller", "not_object_json")
        record_ingest_error("rest_poller", "json must be object")
        return

    ok = ingest_json_payload_for_device(
        data,
        body,
        device_id=device_id,
        protocol_source="rest_poll",
        device_endpoint_id=endpoint_id,
    )
    if ok:
        record_ingest_success("rest_poller", health_status="running")
    else:
        record_quality_event("rest_poller", "ingest_reject")
        record_ingest_error("rest_poller", "ingest failed")


def main() -> None:
    start_worker_heartbeat("worker-rest-poller")
    write_adapter_boot("rest_poller", status="running")
    last_poll: dict[uuid.UUID, float] = {}

    while True:
        try:
            rows = _load_poll_rows()
        except Exception:
            log.exception("rest_poller load endpoints failed")
            time.sleep(10)
            continue

        if not rows:
            set_adapter_status("rest_poller", "idle")
            time.sleep(15)
            continue

        set_adapter_status("rest_poller", "running")
        now = time.monotonic()
        for endpoint_id, device_id, cfg, col_interval in rows:
            interval = _poll_interval_seconds(cfg, col_interval)
            prev = last_poll.get(device_id, 0.0)
            if now - prev < interval:
                continue
            last_poll[device_id] = time.monotonic()
            try:
                _poll_one(endpoint_id, device_id, cfg)
            except Exception:
                log.exception("rest_poller device=%s", device_id)
                record_poll_attempt("rest_poller", ok=False)
                record_ingest_error("rest_poller", "poll handler exception")

        time.sleep(1.0)


if __name__ == "__main__":
    main()
