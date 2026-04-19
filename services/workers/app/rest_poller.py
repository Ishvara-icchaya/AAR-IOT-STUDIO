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


def _cfg_str(cfg: dict[str, Any], *keys: str) -> str:
    for k in keys:
        v = cfg.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return ""


def _rest_mode(cfg: dict[str, Any]) -> str:
    return _cfg_str(cfg, "rest_mode", "restMode").lower()


def _effective_polling_url(cfg: dict[str, Any]) -> str:
    """Explicit ``polling_url`` / ``pollingUrl``, else composite ``url`` (host+port+path from UI)."""
    pu = _cfg_str(cfg, "polling_url", "pollingUrl")
    if pu:
        return pu
    return _cfg_str(cfg, "url")


def _headers_json_raw(cfg: dict[str, Any]) -> str:
    return _cfg_str(cfg, "headers_json", "headersJson")


def _auth_type(cfg: dict[str, Any]) -> str:
    return _cfg_str(cfg, "auth_type", "authType").lower()


def _auth_header_name(cfg: dict[str, Any]) -> str:
    return _cfg_str(cfg, "auth_header_name", "authHeaderName")


def _auth_header_value(cfg: dict[str, Any]) -> str:
    v = cfg.get("auth_header_value")
    if v is None:
        v = cfg.get("authHeaderValue")
    return str(v) if v is not None else ""


def _inbound_hook_endpoint_count() -> int:
    """How many active HTTP endpoints are Inbound hook (poller ignores these)."""
    try:
        conn = psycopg2.connect(db_url())
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(*)::int FROM device_endpoints
                    WHERE is_active = true AND LOWER(protocol) IN ('http', 'https', 'rest')
                    AND LOWER(COALESCE(config->>'rest_mode', config->>'restMode', '')) = 'inbound_hook'
                    """
                )
                row = cur.fetchone()
                return int(row[0] or 0) if row else 0
        finally:
            conn.close()
    except Exception:
        log.debug("rest_poller inbound_hook count query failed", exc_info=True)
        return 0


def _load_poll_rows() -> list[tuple[uuid.UUID, uuid.UUID, dict[str, Any], int]]:
    conn = psycopg2.connect(db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, device_id::text, config, polling_interval_seconds
                FROM device_endpoints
                WHERE is_active = true AND protocol IN ('http', 'https', 'rest')
                """
            )
            out: list[tuple[uuid.UUID, uuid.UUID, dict[str, Any], int]] = []
            for eid_s, did_s, cfg, poll_col in cur.fetchall():
                c = cfg if isinstance(cfg, dict) else {}
                if _rest_mode(c) != "polling":
                    continue
                url = _effective_polling_url(c)
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
    hj = _headers_json_raw(cfg)
    if hj:
        try:
            parsed = json.loads(hj)
            if isinstance(parsed, dict):
                headers = {str(k): str(v) for k, v in parsed.items()}
        except json.JSONDecodeError:
            log.warning("rest_poller bad headers_json")
    auth_type = _auth_type(cfg)
    if auth_type == "bearer":
        tok = _auth_header_value(cfg)
        headers["Authorization"] = f"Bearer {tok}"
    elif auth_type == "header":
        name = _auth_header_name(cfg) or "Authorization"
        headers[name] = _auth_header_value(cfg)
    return headers


def _rest_poll_http_method(cfg: dict[str, Any]) -> str:
    """Match API connectivity: GET default; disallow PUT/PATCH/DELETE for typical upstream polls."""
    raw = cfg.get("method")
    if raw is None or (isinstance(raw, str) and not str(raw).strip()):
        raw = cfg.get("httpMethod") or cfg.get("http_method")
    m = str(raw or "GET").strip().upper() or "GET"
    allowed = frozenset({"GET", "HEAD", "POST"})
    if m not in allowed:
        log.info("rest_poller: unsupported HTTP method %r, using GET", m)
        return "GET"
    return m


def _poll_interval_seconds(cfg: dict[str, Any], column_interval: int) -> int:
    raw = cfg.get("polling_interval_seconds")
    if raw is None:
        raw = cfg.get("pollingIntervalSeconds")
    try:
        from_cfg = int(raw) if raw is not None else column_interval
    except (TypeError, ValueError):
        from_cfg = column_interval
    return max(5, from_cfg)


def _poll_one(endpoint_id: uuid.UUID, device_id: uuid.UUID, cfg: dict[str, Any]) -> None:
    url = _effective_polling_url(cfg)
    method = _rest_poll_http_method(cfg)
    timeout_s = cfg.get("timeout_seconds")
    if timeout_s is None:
        timeout_s = cfg.get("timeoutSeconds")
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
        log.info(
            "rest_poller poll ok device=%s url=%s",
            device_id,
            safe_url_for_log(url),
        )
    else:
        record_quality_event("rest_poller", "ingest_reject")
        record_ingest_error("rest_poller", "ingest failed")


def main() -> None:
    start_worker_heartbeat("worker-rest-poller")
    write_adapter_boot("rest_poller", status="running")
    log.info(
        "rest_poller started — polls active device_endpoints with rest_mode=polling (http/https/rest)"
    )
    last_poll: dict[uuid.UUID, float] = {}
    last_idle_log_mono = 0.0

    while True:
        try:
            rows = _load_poll_rows()
        except Exception:
            log.exception("rest_poller load endpoints failed")
            time.sleep(10)
            continue

        if not rows:
            set_adapter_status("rest_poller", "idle")
            now_mono = time.monotonic()
            if now_mono - last_idle_log_mono >= 60.0:
                last_idle_log_mono = now_mono
                inbound_n = _inbound_hook_endpoint_count()
                extra = ""
                if inbound_n > 0:
                    extra = (
                        f" You have {inbound_n} active HTTP/REST endpoint(s) on Inbound hook; "
                        "switch REST mode to Outbound polling so worker-rest-poller can GET your upstream URL. "
                        "Inbound hook only accepts POSTs to the platform /ingest/raw."
                    )
                log.info(
                    "rest_poller idle — no matching device_endpoints. Need: endpoint is_active, protocol "
                    "http/https/rest, config.rest_mode=polling, and polling_url or composite url (host+port+path).%s",
                    extra,
                )
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
