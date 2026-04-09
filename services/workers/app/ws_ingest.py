"""WebSocket client(s): one connection per active device_endpoint (protocol=websocket)."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any

import psycopg2
import websockets

from app.ingest_archive import db_url, ingest_json_payload_for_device
from app.ingress_redis_metrics import (
    record_ingest_error,
    record_ingest_success,
    record_quality_event,
    set_adapter_status,
    write_adapter_boot,
)
from app.log_redact import safe_url_for_log
from app.logging_setup import configure_logging
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)


def _load_rows() -> list[tuple[uuid.UUID, dict[str, Any]]]:
    conn = psycopg2.connect(db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, device_id::text, config
                FROM device_endpoints
                WHERE is_active = true AND protocol = 'websocket'
                """
            )
            out: list[tuple[uuid.UUID, uuid.UUID, dict[str, Any]]] = []
            for eid_s, did_s, cfg in cur.fetchall():
                c = cfg if isinstance(cfg, dict) else {}
                out.append((uuid.UUID(eid_s), uuid.UUID(did_s), c))
            return out
    finally:
        conn.close()


def _float_cfg(raw: Any, default: float) -> float:
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


async def _device_loop(endpoint_id: uuid.UUID, device_id: uuid.UUID, config: dict[str, Any]) -> None:
    url = (config.get("url") or "").strip()
    if not url:
        log.warning("websocket-ingest skip device=%s (no url)", device_id)
        return

    delay_f = max(1.0, _float_cfg(config.get("reconnect_delay_seconds"), 5.0))
    ping_interval = max(5.0, _float_cfg(config.get("ping_interval_seconds"), 30.0))
    open_timeout = max(5.0, _float_cfg(config.get("open_timeout_seconds"), 30.0))

    headers: dict[str, str] = {}
    hj = config.get("headers_json")
    if isinstance(hj, str) and hj.strip():
        try:
            parsed = json.loads(hj)
            if isinstance(parsed, dict):
                headers = {str(k): str(v) for k, v in parsed.items()}
        except json.JSONDecodeError:
            log.warning("websocket-ingest device=%s invalid headers_json", device_id)

    hdr_list: list[tuple[str, str]] | None = list(headers.items()) if headers else None
    sub = (config.get("subprotocol") or "").strip()
    subprotocols = [sub] if sub else None

    while True:
        try:
            set_adapter_status("websocket", "connecting")
            async with websockets.connect(
                url,
                additional_headers=hdr_list,
                subprotocols=subprotocols,
                open_timeout=open_timeout,
                ping_interval=ping_interval,
                ping_timeout=ping_interval + 10,
            ) as ws:
                set_adapter_status("websocket", "connected")
                log.info(
                    "websocket-ingest connected device=%s url=%s",
                    device_id,
                    safe_url_for_log(url),
                )
                async for raw in ws:
                    if isinstance(raw, bytes):
                        text = raw.decode("utf-8", errors="replace")
                    else:
                        text = raw
                    try:
                        data = json.loads(text)
                    except json.JSONDecodeError:
                        record_quality_event("websocket", "malformed_json")
                        record_ingest_error("websocket", "invalid json")
                        continue
                    if not isinstance(data, dict):
                        record_quality_event("websocket", "malformed_not_object")
                        record_ingest_error("websocket", "non-object json")
                        continue
                    body = json.dumps(data, separators=(",", ":"), sort_keys=True).encode(
                        "utf-8"
                    )
                    ok = ingest_json_payload_for_device(
                        data,
                        body,
                        device_id=device_id,
                        protocol_source="websocket",
                        device_endpoint_id=endpoint_id,
                    )
                    if ok:
                        record_ingest_success("websocket", health_status="connected")
                    else:
                        record_quality_event("websocket", "ingest_reject")
                        record_ingest_error("websocket", "ingest failed")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            record_quality_event("websocket", "reconnect_failure")
            log.warning(
                "websocket-ingest device=%s url=%s error=%s reconnect_in=%ss",
                device_id,
                safe_url_for_log(url),
                e,
                delay_f,
            )
            record_ingest_error("websocket", str(e)[:200])
            set_adapter_status("websocket", "reconnecting")
            await asyncio.sleep(delay_f)


async def _run() -> None:
    write_adapter_boot("websocket", status="starting")
    rows = _load_rows()
    while not rows:
        log.warning("websocket-ingest: no active device_endpoints with protocol=websocket")
        set_adapter_status("websocket", "idle")
        await asyncio.sleep(60)
        rows = _load_rows()

    tasks = [
        asyncio.create_task(_device_loop(eid, did, cfg), name=f"ws-{did}")
        for eid, did, cfg in rows
    ]
    try:
        await asyncio.gather(*tasks)
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def main() -> None:
    start_worker_heartbeat("worker-websocket-ingest")
    asyncio.run(_run())


if __name__ == "__main__":
    main()
