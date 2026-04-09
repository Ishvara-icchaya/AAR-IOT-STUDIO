"""Protocol-specific handlers for validated raw.ingest envelopes (v1)."""

from __future__ import annotations

import logging
from collections.abc import Callable

log = logging.getLogger(__name__)

_generic_handlers: list[Callable[[dict], None]] = []
_protocol_handlers: dict[str, list[Callable[[dict], None]]] = {}


def add_generic(handler: Callable[[dict], None]) -> None:
    _generic_handlers.append(handler)


def add_protocol(protocol_id: str, handler: Callable[[dict], None]) -> None:
    _protocol_handlers.setdefault(protocol_id, []).append(handler)


def dispatch_envelope(envelope: dict) -> None:
    errors: list[Exception] = []
    for fn in _generic_handlers:
        try:
            fn(envelope)
        except Exception as e:
            log.exception("ingest generic subscriber failed")
            errors.append(e)
    pid = envelope.get("protocol_id")
    if isinstance(pid, str) and pid:
        for fn in _protocol_handlers.get(pid, []):
            try:
                fn(envelope)
            except Exception as e:
                log.exception("ingest protocol subscriber failed protocol_id=%s", pid)
                errors.append(e)
    if errors:
        raise errors[-1]
