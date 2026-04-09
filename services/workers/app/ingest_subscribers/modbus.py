"""Modbus-oriented ingest hook (stub — attach framing/parser later)."""

from __future__ import annotations

import logging

from app.ingest_subscribers.registry import add_protocol

log = logging.getLogger(__name__)


def on_modbus_envelope(envelope: dict) -> None:
    log.info(
        "ingest.modbus stub raw_object_id=%s storage_key=%s",
        envelope.get("raw_object_id"),
        envelope.get("storage_key"),
    )


add_protocol("modbus", on_modbus_envelope)
