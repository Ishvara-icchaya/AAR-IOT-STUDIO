# Canonical device identity for multi-protocol raw ingest

## Endpoint-bound ingest (default for configured transports)

When the platform receives data through a **saved `device_endpoints` row**, that row is the **canonical binding** to an AAR **device** (and thus **customer** and **site** via `devices`):

| Transport | Binding |
|-----------|---------|
| **MQTT** | Subscription is tied to endpoint(s) in the bridge plan; each message is archived using matching endpoint id(s). |
| **WebSocket** | One outbound client per active websocket endpoint row. |
| **REST polling** | `worker-rest-poller` polls using the endpoint row. |
| **HTTP `POST /ingest/raw`** | Authenticated upload; `device_id` is chosen by the API caller (explicit target device). |

For these paths:

- Incoming JSON may contain upstream fields such as `device_id`, `site_id`, or vendor-specific names. They are **not** used to select the AAR device.
- Those fields are **optional source metadata** only. They are **not required** to match AAR UUIDs or names.
- The **raw JSON body** stored in MinIO is the **original bytes** from the wire when the adapter provides them (MQTT payload, HTTP response body, etc.), so upstream identity fields remain unchanged in the archived document.
- The worker may populate **`raw_data_objects.ingest_metadata`** (JSONB) and the Kafka **`raw.ingest`** envelope with:
  - `source_device_id` — value of the configured payload key (default env `MQTT_DEVICE_KEY`, usually `device_id`), if present.
  - `source_site_id` — value of `MQTT_SITE_KEY` (usually `site_id`), if present.
  - `device_endpoint_id` — UUID of the `device_endpoints` row when applicable.

Implementation: `services/workers/app/ingest_archive.py` — `ingest_json_payload_for_endpoint`, `ingest_json_payload_for_device` (with optional `device_endpoint_id`), `build_ingest_metadata_from_payload`, `_persist_core`.

## Unbound ingest (no device_endpoint context)

**CoAP listener** today exposes a **shared** resource and does **not** load a per-request endpoint id. For those messages the platform still must choose a device using **payload-based resolution**: `ingest_json_payload` → `resolve_device_row` matches a UUID or device **name** (+ optional site **name**) to rows in `devices` / `sites`.

Use this path only when there is **no** pre-bound endpoint. Operators should align payload identifiers with registered devices if they use CoAP in this mode, or future work can add CoAP routing bound to an endpoint.

## MQTT optional fallback

If a message topic matches **only** non-UUID subscription hooks (e.g. env `MQTT_TOPICS` without a real endpoint), the bridge falls back to **`ingest_json_payload`** (payload-based resolution) so legacy setups keep working.

## Fixed-device transports (summary)

WebSocket and REST polling use **`ingest_json_payload_for_device`** with `device_id` from the endpoint row and optional **`device_endpoint_id`** for metadata.

## Related

- `docs/CANONICAL_RAW_INGEST.md`, `docs/ARCHITECTURE_MQTT_INGEST.md`
- Code: `ingest_archive.resolve_device_row` (unbound only), `ingest_json_payload`, `ingest_json_payload_for_device`, `ingest_json_payload_for_endpoint`
