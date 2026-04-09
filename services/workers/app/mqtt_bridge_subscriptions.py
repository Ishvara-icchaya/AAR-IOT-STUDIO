"""MQTT ingest subscription plan from device_endpoints (per-broker grouping) + optional MQTT_TOPICS env.

Phase 1 model: **one MQTT client connection per distinct broker profile** (host, port, TLS, auth,
optional explicit client_id). Subscriptions on that connection are the union of all active
device endpoint topics that share that profile, with QoS = max per topic.

Published-services MQTT (workflow / publish_dispatch) is separate — see docs/ARCHITECTURE_MQTT_INGEST.md.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import psycopg2

log = logging.getLogger(__name__)


def _db_url() -> str:
    u = os.environ.get("METADATA_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    return u.replace("postgresql+psycopg2://", "postgresql://")


def _str_clean(v: Any, default: str = "") -> str:
    if v is None:
        return default
    return str(v).strip()


def _qos_int(raw: Any) -> int:
    try:
        q = int(raw)
    except (TypeError, ValueError):
        return 0
    return max(0, min(2, q))


@dataclass(frozen=True)
class ConnectionKey:
    """Hashable broker connection identity (matches Manage Devices saved MQTT endpoint config)."""

    host: str
    port: int
    use_tls: bool
    username: str
    password: str
    client_id_explicit: str  # "" → bridge generates a unique id per group


@dataclass
class SubscriptionSource:
    endpoint_id: str
    device_id: str
    device_name: str


@dataclass
class MergedTopicSubscription:
    topic: str
    qos: int
    sources: list[SubscriptionSource] = field(default_factory=list)


@dataclass
class BrokerIngestGroup:
    """One MQTT client: connect to key, subscribe to merged_topics."""

    key: ConnectionKey
    mqtt_client_id: str
    merged_topics: list[MergedTopicSubscription]

    def sorted_topics(self) -> list[MergedTopicSubscription]:
        return sorted(self.merged_topics, key=lambda x: x.topic)


@dataclass
class IngestPlan:
    groups: list[BrokerIngestGroup]

    def fingerprint(self) -> str:
        """Stable string for resync diff (no passwords)."""
        parts: list[dict[str, Any]] = []
        for g in sorted(self.groups, key=lambda x: (x.key.host, x.key.port, x.mqtt_client_id)):
            parts.append(
                {
                    "host": g.key.host,
                    "port": g.key.port,
                    "tls": g.key.use_tls,
                    "user": g.key.username,
                    "client_id": g.mqtt_client_id,
                    "topics": [
                        {"t": m.topic, "q": m.qos, "src": sorted((s.endpoint_id for s in m.sources))}
                        for m in sorted(g.merged_topics, key=lambda x: x.topic)
                    ],
                }
            )
        return json.dumps(parts, sort_keys=True, separators=(",", ":"))

    def all_topics_flat(self) -> dict[str, int]:
        """Union topic -> max QoS (monitoring / legacy)."""
        out: dict[str, int] = {}
        for g in self.groups:
            for m in g.merged_topics:
                out[m.topic] = max(out.get(m.topic, 0), m.qos)
        return out

    def to_snapshot_dict(self, resync_interval_seconds: int) -> dict[str, Any]:
        flat = self.all_topics_flat()
        connections: list[dict[str, Any]] = []
        for g in self.groups:
            auth_mode = "user" if g.key.username else "none"
            connections.append(
                {
                    "broker_host": g.key.host,
                    "broker_port": g.key.port,
                    "use_tls": g.key.use_tls,
                    "auth_mode": auth_mode,
                    "mqtt_client_id": g.mqtt_client_id,
                    "subscriptions": [
                        {
                            "topic": m.topic,
                            "qos": m.qos,
                            "sources": [
                                {
                                    "endpoint_id": s.endpoint_id,
                                    "device_id": s.device_id,
                                    "device_name": s.device_name,
                                }
                                for s in m.sources
                            ],
                        }
                        for m in g.sorted_topics()
                    ],
                }
            )
        return {
            "last_resync_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "subscribed_topics": sorted(flat.keys()),
            "resync_interval_seconds": resync_interval_seconds,
            "connections": connections,
        }


def connection_key_from_saved_config(cfg: dict[str, Any]) -> ConnectionKey | None:
    """Normalize device_endpoints.config for MQTT (parity with frontend mqttFieldsToConfig)."""
    if not isinstance(cfg, dict):
        return None
    mode = _str_clean(cfg.get("broker_mode"), "external").lower()
    host = _str_clean(cfg.get("broker_host") or cfg.get("host"))
    if mode == "internal" and not host:
        host = "mosquitto"
    if not host:
        return None
    raw_port = cfg.get("broker_port", cfg.get("port", 1883))
    try:
        port = int(raw_port)
    except (TypeError, ValueError):
        port = 1883
    use_tls = bool(cfg.get("use_tls")) or port == 8883
    user = _str_clean(cfg.get("username"))
    pw_raw = cfg.get("password")
    password = _str_clean(pw_raw) if pw_raw is not None else ""
    cid = _str_clean(cfg.get("client_id"))
    return ConnectionKey(
        host=host,
        port=port,
        use_tls=use_tls,
        username=user,
        password=password,
        client_id_explicit=cid,
    )


def _resolve_mqtt_client_id(base: str, key: ConnectionKey) -> str:
    if key.client_id_explicit:
        return key.client_id_explicit[:128] or base
    fp = f"{key.host}|{key.port}|{key.use_tls}|{key.username}|{key.password}"
    h = hashlib.sha256(fp.encode()).hexdigest()[:12]
    safe_base = (base or "aar-mqtt-bridge").strip() or "aar-mqtt-bridge"
    return f"{safe_base}-{h}"


def _fetch_endpoint_rows() -> list[tuple[str, str, str, dict[str, Any]]]:
    """Returns list of (endpoint_id, device_id, device_name, config)."""
    out: list[tuple[str, str, str, dict[str, Any]]] = []
    try:
        conn = psycopg2.connect(_db_url())
    except Exception:
        log.warning("mqtt_bridge DB unavailable for ingest plan", exc_info=True)
        return out
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT de.id::text, de.device_id::text, d.name, de.config
                FROM device_endpoints de
                INNER JOIN devices d ON d.id = de.device_id
                WHERE de.protocol = 'mqtt'
                  AND de.is_active = true
                  AND d.is_active = true
                """
            )
            for eid, did, dname, cfg in cur.fetchall():
                if isinstance(cfg, dict):
                    out.append((eid, did, str(dname or ""), cfg))
    finally:
        conn.close()
    return out


def _env_fallback_connection_key() -> ConnectionKey | None:
    """MQTT_TOPICS-only subscriptions use global broker env (optional legacy / ops hook)."""
    host = _str_clean(os.environ.get("MQTT_BROKER_HOST"))
    if not host:
        return None
    try:
        port = int(os.environ.get("MQTT_BROKER_PORT", "1883"))
    except ValueError:
        port = 1883
    use_tls = os.environ.get("MQTT_BROKER_USE_TLS", "").lower() in ("1", "true", "yes") or port == 8883
    user = _str_clean(os.environ.get("MQTT_USERNAME"))
    password = _str_clean(os.environ.get("MQTT_PASSWORD"))
    cid = _str_clean(os.environ.get("MQTT_FALLBACK_CLIENT_ID"))
    return ConnectionKey(
        host=host,
        port=port,
        use_tls=use_tls,
        username=user,
        password=password,
        client_id_explicit=cid,
    )


def build_ingest_plan() -> IngestPlan:
    """Build grouped broker connections and merged subscriptions from DB + env."""
    base_cid = os.environ.get("MQTT_CLIENT_ID", "aar-worker-mqtt-bridge").strip() or "aar-worker-mqtt-bridge"

    # key -> topic -> MergedTopicSubscription
    buckets: dict[ConnectionKey, dict[str, MergedTopicSubscription]] = {}

    for eid, did, dname, cfg in _fetch_endpoint_rows():
        key = connection_key_from_saved_config(cfg)
        topic = cfg.get("topic")
        ts = _str_clean(topic) if topic is not None else ""
        if not key:
            log.warning(
                "mqtt_bridge skipping mqtt endpoint endpoint_id=%s device_id=%s: missing broker_host",
                eid,
                did,
            )
            continue
        if not ts:
            log.warning(
                "mqtt_bridge skipping mqtt endpoint endpoint_id=%s device_id=%s: empty topic",
                eid,
                did,
            )
            continue
        qos = _qos_int(cfg.get("qos", 0))
        src = SubscriptionSource(endpoint_id=eid, device_id=did, device_name=dname)
        if key not in buckets:
            buckets[key] = {}
        subs = buckets[key]
        if ts not in subs:
            subs[ts] = MergedTopicSubscription(topic=ts, qos=qos, sources=[src])
        else:
            mt = subs[ts]
            mt.qos = max(mt.qos, qos)
            mt.sources.append(src)

    raw_topics = (_str_clean(os.environ.get("MQTT_TOPICS")) or "").strip()
    if raw_topics:
        ek = _env_fallback_connection_key()
        if not ek:
            log.warning(
                "mqtt_bridge MQTT_TOPICS is set but MQTT_BROKER_HOST is empty — "
                "cannot subscribe to env topics (set MQTT_BROKER_HOST or use device endpoints only)",
            )
        else:
            if ek not in buckets:
                buckets[ek] = {}
            env_src = SubscriptionSource(
                endpoint_id="env:MQTT_TOPICS",
                device_id="-",
                device_name="(MQTT_TOPICS)",
            )
            for part in raw_topics.split(","):
                p = part.strip()
                if not p:
                    continue
                if p not in buckets[ek]:
                    buckets[ek][p] = MergedTopicSubscription(topic=p, qos=0, sources=[env_src])
                else:
                    buckets[ek][p].sources.append(env_src)

    groups: list[BrokerIngestGroup] = []
    for key, topic_map in buckets.items():
        cid = _resolve_mqtt_client_id(base_cid, key)
        merged = list(topic_map.values())
        groups.append(BrokerIngestGroup(key=key, mqtt_client_id=cid, merged_topics=merged))

    groups.sort(key=lambda g: (g.key.host, g.key.port, g.mqtt_client_id))
    _dedupe_mqtt_client_ids(groups)
    return IngestPlan(groups=groups)


def _dedupe_mqtt_client_ids(groups: list[BrokerIngestGroup]) -> None:
    """Avoid broker-side client_id collisions when profiles differ but resolved ids match."""
    used: set[str] = set()
    for g in groups:
        orig = g.mqtt_client_id
        candidate = orig
        n = 0
        while candidate in used:
            n += 1
            candidate = f"{orig}-{n}"
        used.add(candidate)
        if candidate != orig:
            log.warning(
                "mqtt_bridge mqtt_client_id collision resolved orig=%r -> %r broker=%s:%s",
                orig,
                candidate,
                g.key.host,
                g.key.port,
            )
        g.mqtt_client_id = candidate
