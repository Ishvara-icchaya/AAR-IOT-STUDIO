# Canonical raw ingest (locked)

This document records **stable contracts** for AAR-IoT-Studio raw ingest. Breaking changes require a new `schema_version` (e.g. `"2"`) or an explicit platform migration plan.

**Product ingress modes** (MQTT, REST, CoAP, WebSocket) and operational requirements: **`docs/CANONICAL_INGRESS_PRODUCT.md`**.

**Device identity** (payload `device_id` / `site_id`, ambiguity, fixed-device paths): **`docs/CANONICAL_DEVICE_IDENTITY_INGEST.md`**.

## 1. Source of truth (SoT)

- **Postgres** row in `raw_data_objects` **plus** the **MinIO** object at `storage_key` together form the canonical raw ingest record.
- Kafka messages are **notifications** referencing that SoT, not a second source of truth.

## 2. Envelope contract (frozen v1)

- **`RawIngestEnvelopeV1`** (`schema_version: "1"`) is **frozen**: do not change field semantics without bumping to `"2"`.
- Tolerant consumers may ignore unknown JSON keys; producers may add optional keys (e.g. `trace_id`) without breaking v1 parsers that allow extras.

## 3. Topic contract

- **`raw.ingest`** is the canonical handoff topic from ingest (API and/or gateways) to **`worker-ingest`** and downstream subscribers.
- A separate publish to **`scrubber.input`** after validation is optional for clearer layering; not required for correctness if consumers chain off `raw.ingest`.

## 4. Verify semantics

- **`GET .../raw-data-objects/{id}/verify`** with optional **`rehash=true`** is the integrity model: HEAD/stat by default; full SHA-256 re-read when requested (subject to size limits).
- Verification outcomes are persisted on the row (`verify_status`, `verified_at`, `verify_message`, and lifecycle `ingest_status` when applicable).

## 5. Lifecycle (`ingest_status`)

Suggested progression (persisted on `raw_data_objects.ingest_status`):

| Value | Meaning |
|--------|--------|
| `received` | Reserved for future async accept paths (HTTP sync path currently first-persists as `archived`). |
| `archived` | Row + MinIO object committed. |
| `published_to_kafka` | Optional Kafka publish to `raw.ingest` succeeded after persistence. |
| `verified` | Strong integrity check passed (`rehash=true` + checksum match). |
| `failed` | Integrity or archive failure recorded (e.g. missing object, checksum mismatch). |

## 6. Protocol source normalization

- Envelope **`source`**: transport channel — canonical set includes **`mqtt`**, **`rest`**, **`coap`**, **`websocket`**, **`upload`**, **`modbus`** (extend deliberately).
- Envelope **`protocol_id`**: application/subscriber key (e.g. `modbus`, `mqtt`).
- Column **`protocol_source`** on `raw_data_objects`: normalized application protocol when known, else **`upload`** for generic file upload.

## 7. Trace propagation

- HTTP ingest should populate envelope **`trace_id`** (from `X-Trace-Id` / middleware) so the same id can appear in **`worker-ingest`** and later scrubber/workflow logs.

## 8. MQTT path (same SoT as HTTP)

MQTT telemetry is **not** stored by the frontend or API by subscribing to the broker. It enters the platform through **`worker-mqtt-bridge`**, which:

1. Connects as a **subscriber client** using each device endpoint’s **saved** broker and topic (one MQTT connection per distinct broker profile; see **`docs/ARCHITECTURE_MQTT_INGEST.md`**).
2. Persists each JSON payload to **MinIO** and inserts **`raw_data_objects`** (same columns and lifecycle as HTTP multipart ingest).
3. Publishes **`RawIngestEnvelopeV1`** to **`raw.ingest`**, so **`worker-ingest` → scrubber.input → …** matches the rest of the pipeline.

The Manage Devices “ingested payload” view reads **`raw_data_objects`** via the API only; MQTT messages appear there only after this bridge path completes. See **`docs/ARCHITECTURE_MQTT_INGEST.md`** for broker modes, monitoring, and ports configuration.

## Recommended next implementation steps

1. Raw data list UI (`/devices/raw`) — done in app shell.
2. Scrubber entry from selected `raw_data_object` — `/scrubber/data-objects`, `/scrubber/create`.
3. Persist `device_objects.mapping.scrubberStudio` — `PATCH /device-endpoints` / **`PATCH /device-objects`** with merged mapping.
4. Scrubber runtime bridge — publish **`scrubber.input`** or extend `worker-ingest` after validation; produce **`data_object`** rows.
5. Pipeline event schema for post-raw stages (scrubber → workflow → result).
