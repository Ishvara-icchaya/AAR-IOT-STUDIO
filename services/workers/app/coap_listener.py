"""CoAP server: JSON payloads → same archive path as MQTT (MinIO + DB + raw.ingest)."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid as uuid_mod

from aiocoap import message, resource
from aiocoap import Context
from aiocoap.numbers.codes import Code

from app.ingest_archive import ingest_json_payload, ingest_json_payload_for_v2_endpoint
from app.ingress_redis_metrics import (
    record_ingest_error,
    record_ingest_success,
    record_quality_event,
    set_adapter_status,
    write_adapter_boot,
)
from app.logging_setup import configure_logging
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)


def _resource_path_tuple() -> tuple[str, ...]:
    raw = (os.environ.get("COAP_RESOURCE_PATH") or "ingest").strip().strip("/")
    if not raw:
        return ("ingest",)
    return tuple(seg for seg in raw.split("/") if seg)


class CoapIngestResource(resource.Resource):
    """Accept CoAP POST/PUT with UTF-8 JSON body. No per-request endpoint binding — device comes from payload resolution."""

    async def render_post(self, request: message.Message) -> message.Message:
        return await self._handle(request)

    async def render_put(self, request: message.Message) -> message.Message:
        return await self._handle(request)

    async def _handle(self, request: message.Message) -> message.Message:
        try:
            raw = request.payload
            if not raw:
                record_quality_event("coap", "malformed_empty")
                record_ingest_error("coap", "empty payload")
                return message.Message(code=Code.BAD_REQUEST, payload=b"empty body")
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                record_quality_event("coap", "malformed_utf8")
                record_ingest_error("coap", "invalid utf-8")
                return message.Message(code=Code.BAD_REQUEST, payload=b"utf-8 required")
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                record_quality_event("coap", "malformed_json")
                record_ingest_error("coap", "invalid json")
                return message.Message(code=Code.BAD_REQUEST, payload=b"json required")
            if not isinstance(data, dict):
                record_quality_event("coap", "malformed_not_object")
                record_ingest_error("coap", "json must be object")
                return message.Message(code=Code.BAD_REQUEST, payload=b"object required")
            body = json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8")
            coap_ep = (os.environ.get("COAP_ENDPOINT_ID") or "").strip()
            if coap_ep:
                try:
                    eid = uuid_mod.UUID(coap_ep)
                except ValueError:
                    record_quality_event("coap", "invalid_coap_endpoint_id")
                    record_ingest_error("coap", "COAP_ENDPOINT_ID is not a valid UUID")
                    return message.Message(code=Code.BAD_REQUEST, payload=b"invalid COAP_ENDPOINT_ID")
                ok = ingest_json_payload_for_v2_endpoint(
                    data,
                    body,
                    endpoint_id=eid,
                    protocol_source="coap",
                    require_protocol="coap",
                )
            else:
                ok = ingest_json_payload(data, body, protocol_source="coap")
            if ok:
                record_ingest_success("coap", health_status="listening")
                return message.Message(code=Code.CHANGED)
            record_quality_event("coap", "ingest_reject")
            record_ingest_error("coap", "ingest failed (device or persistence)")
            return message.Message(code=Code.BAD_REQUEST, payload=b"ingest failed")
        except Exception as e:
            log.exception("coap_listener handler error")
            record_quality_event("coap", "handler_exception")
            record_ingest_error("coap", str(e)[:200])
            return message.Message(code=Code.INTERNAL_SERVER_ERROR, payload=b"error")


async def _serve_forever() -> None:
    path = _resource_path_tuple()
    root = resource.Site()
    root.add_resource(path, CoapIngestResource())

    host = (os.environ.get("COAP_BIND_HOST") or "0.0.0.0").strip() or "0.0.0.0"
    try:
        port = int(os.environ.get("COAP_BIND_PORT", "5683"))
    except ValueError:
        port = 5683

    log.info("coap_listener binding %s:%s path=%s", host, port, "/".join(path))
    write_adapter_boot("coap", status="listening")
    set_adapter_status("coap", "listening")

    await Context.create_server_context(root, bind=(host, port))
    await asyncio.get_running_loop().create_future()


def main() -> None:
    start_worker_heartbeat("worker-coap-listener")
    try:
        asyncio.run(_serve_forever())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
