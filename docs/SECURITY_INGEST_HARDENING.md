# Ingest security and hardening (beyond Phase 1)

Phase 1 prioritizes **correct multi-protocol ingest** and **observability**. The items below are **explicit follow-ups** for production hardening.

## REST poller

- Review **credential storage** in `device_endpoints.config` (bearer tokens, header secrets): encryption at rest, rotation, least-privilege URLs.
- Validate **SSRF** risk: polling URLs should be restricted to expected hosts or patterns where the product model allows.
- Timeouts and **max response size** should align with `RAW_INGEST_MAX_BYTES` and operational limits.

## WebSocket

- **Tokens in `headers_json`**: never log raw headers at INFO; workers use `log_redact.redact_headers_for_log` where headers are materialized; URLs are logged with **query stripped** via `safe_url_for_log`.
- Prefer **short-lived tokens** and reconnect flows that refresh credentials without persisting long-lived secrets in device config.

## CoAP

- CoAP listener is **UDP** and typically **unauthenticated** at the transport layer in Phase 1. Restrict exposure with **firewall / security groups**, bind addresses, and optional future **DTLS** or **application tokens** in the payload contract.
- Rate limiting and **payload size limits** should match deployment risk.

## MQTT

- Move from **anonymous / password-in-compose** dev posture to **TLS**, per-device credentials, ACLs on broker topics, and private networks where applicable.

## REST inbound (`POST /ingest/raw`)

- JWT and tenant scoping are authoritative; extend metrics to include **auth failures** if product requires alerting on abuse.

This document is **non-normative** for Phase 1 behavior; it records intent for security review.
