"""Runs for every validated envelope."""

from __future__ import annotations

import logging

from app.ingest_subscribers.registry import add_generic

log = logging.getLogger(__name__)


def on_envelope(envelope: dict) -> None:
    log.info(
        "ingest.generic raw_object_id=%s device_id=%s source=%s trace_id=%s size_bytes=%s",
        envelope.get("raw_object_id"),
        envelope.get("device_id"),
        envelope.get("source"),
        envelope.get("trace_id"),
        envelope.get("size_bytes"),
    )


add_generic(on_envelope)
