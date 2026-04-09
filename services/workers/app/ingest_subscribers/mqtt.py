"""MQTT gateway ingest hook (stub)."""

from __future__ import annotations

import logging

from app.ingest_subscribers.registry import add_protocol

log = logging.getLogger(__name__)


def on_mqtt_envelope(envelope: dict) -> None:
    log.info(
        "ingest.mqtt stub raw_object_id=%s storage_key=%s",
        envelope.get("raw_object_id"),
        envelope.get("storage_key"),
    )


add_protocol("mqtt", on_mqtt_envelope)
