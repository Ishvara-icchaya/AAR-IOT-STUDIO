# Canonical ingress — product specification (AAR-IoT-Studio)

AAR-IoT-Studio is an IoT platform. **Approved ingress modes** are product capabilities, not ad-hoc scripts. Every mode must converge on the **same canonical raw ingest architecture** (no protocol-specific shortcuts that skip archive or metadata).

## Canonical pipeline (mandatory)

For **MQTT**, **REST**, **CoAP**, and **WebSocket**:

```text
Ingress adapter / broker / listener
  → raw_data_object (Postgres)
  → MinIO object at storage_key
  → Kafka topic raw.ingest (envelope v1)
  → worker-ingest
  → scrubber.input (when enabled)
  → data_object
```

Reference contracts: `docs/CANONICAL_RAW_INGEST.md`, `docs/ARCHITECTURE_MQTT_INGEST.md`, **`docs/CANONICAL_DEVICE_IDENTITY_INGEST.md`** (shared device resolution).

## Approved ingress modes

| Mode | Product role | In-stack components (typical) |
|------|----------------|------------------------------|
| **REST** | Platform-hosted HTTP ingest + optional outbound polling | FastAPI `POST /api/v1/ingest/raw`, future poller worker |
| **MQTT** | Broker (external or Mosquitto) + bridge | `worker-mqtt-bridge`, optional `mosquitto` |
| **CoAP** | **Listener / adapter** (not a broker) | Future `coap-listener` service |
| **WebSocket** | **Real-time listener** | Future `websocket-ingest` service |

## REST — product requirements

- **Inbound**: Multipart upload to **`/api/v1/ingest/raw`** with authenticated user; flows through `raw_ingest_service` (MinIO + DB + Kafka).
- **Outbound polling**: Device endpoint config stores `rest_mode: polling`, upstream URL, interval, headers, auth — processed by **`worker-rest-poller`** when deployed.
- **Monitoring**: Redis-backed metrics (`ingress_metrics`) — success/fail totals, rolling failure window, last latency, last error. Service row **`rest-ingest`** in Monitoring.
- **Alerts**: Category **`ingest`** when REST failures in ~15m exceed `INGEST_REST_FAILURES_ALERT_THRESHOLD_15M` (deep check). Additional alerts: MinIO/DB failures already emitted from `raw_ingest_service`.
- **Ports**: Logical row **`api`** (REST/API), tenant flags `allow_external_access` / `restrict_to_localhost` on **Platform ports**.

## MQTT — product requirements

**Ingest** (subscriber): **`worker-mqtt-bridge`** opens **one MQTT client connection per distinct saved broker profile** (host, port, TLS, auth, client id) and subscribes to topics from **Manage Devices** MQTT endpoints; optional **`MQTT_TOPICS`** uses env broker only. **Published-services MQTT** (publisher) is separate — `publish_dispatch` / workflow targets, not the bridge.

See `docs/ARCHITECTURE_MQTT_INGEST.md`. Monitoring: **`mosquitto`**, **`worker-mqtt-bridge`**, Redis **`aar:ingress:mqtt:last_ingest_at`** (legacy read fallback: `aar:mqtt_bridge:last_ingest_at`).

## CoAP — product requirements

- Described everywhere as **listener/adapter**, not a broker.
- **Ports**: Logical row **`coap_listener`** (UDP **5683**, default **disabled** until adapter is deployed).
- **Monitoring**: Service **`coap-listener`**; metrics via Redis key **`aar:ingress:coap:snapshot`** (JSON) when adapter is implemented.
- **Alerts**: Malformed payloads (rolling Redis **`quality_events`** + deep thresholds), optional **hot-stream inactivity** (`INGEST_HOT_STREAM_INACTIVITY_SECONDS`); category **`ingest`**, `source_component` e.g. `api.monitoring.ingest.coap`.

## WebSocket — product requirements

- **Ports**: Logical row **`websocket`** (platform ingress port; default **8001** in template).
- **Monitoring**: Service **`websocket-ingest`**; metrics via **`aar:ingress:ws:snapshot`** when adapter is implemented.
- **Alerts**: Reconnect churn (`quality_events` + `INGEST_WEBSOCKET_RECONNECT_EVENTS_ALERT_THRESHOLD_15M`), optional inactivity — **`ingest`** (`api.monitoring.ingest.websocket`).

## Device endpoints (Manage Devices)

Per device, **protocol** is first-class: **http** (REST), **mqtt**, **coap**, **websocket**, **socket**. Config JSON is worker-oriented and includes mode-specific fields (e.g. `rest_mode`, CoAP `adapter_role`, WebSocket `url`, reconnect/ping).

**Payload verification**: Operators use the **raw payload preview** on the same screen after data has traversed the canonical path. Dedicated “test connection” APIs may be added per protocol.

## Platform ports control plane

Canonical logical services (see `port_config_service._CANONICAL_PLATFORM_PORT_SPECS`):

- `api` — REST/API  
- `mqtt_broker`  
- `kafka`  
- `websocket`  
- `coap_listener`  
- `minio`  
- `ollama`  

Plus tenant **MQTT ingest** block and deployment hints in **`GET /admin/ports`**.

## Alert categories

Ingress-related alerts should use category **`ingest`** (or monitoring for pure infra reachability). Use **`source_component`** for disambiguation, e.g. `api.monitoring.rest_ingest`, `api.ingest`, `api.monitoring.mqtt`.

## Redis: last successful archive (per protocol)

After Postgres + MinIO commit, workers set **`aar:ingress:<protocol>:last_ingest_at`** (Unix time string). Canonical segments: `mqtt`, `coap`, `websocket`, `rest_poller`. MQTT continues to refresh the legacy key **`aar:mqtt_bridge:last_ingest_at`** for backward compatibility.

## Implementation status (high level)

| Capability | Status |
|------------|--------|
| REST inbound canonical ingest | **Shipped** (`POST /ingest/raw`) |
| REST metrics + monitoring row + failure alert | **Shipped** (Redis + deep check) |
| REST poller worker | **Shipped** (`worker-rest-poller`, profile `ingress`) |
| MQTT bridge + Mosquitto optional | **Shipped** (see architecture doc) |
| CoAP listener worker | **Shipped** (`worker-coap-listener`, profile `ingress`) |
| WebSocket ingest worker | **Shipped** (`worker-websocket-ingest`, profile `ingress`) |
| Per-protocol quality + inactivity deep alerts | **Shipped** (thresholds in `Settings`; optional inactivity) |
| JWT failures on `/ingest/raw` before handler | **Not counted** in REST metrics (middleware extension possible) |

This document is the **operational source** for product, support, and engineering alignment on ingress.

**Security follow-ups** (Phase 2+): `docs/SECURITY_INGEST_HARDENING.md`.
