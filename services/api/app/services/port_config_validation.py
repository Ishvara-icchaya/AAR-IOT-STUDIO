"""Validate platform port configuration updates."""

from __future__ import annotations

from collections import defaultdict

from fastapi import HTTPException, status

from app.schemas.platform_port import PlatformPortsConfigUpdate


def validate_ports_update(body: PlatformPortsConfigUpdate) -> PlatformPortsConfigUpdate:
    if body.allow_external_access and body.restrict_to_localhost:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "allow_external_access and restrict_to_localhost cannot both be enabled.",
        )
    by_ep: dict[tuple[str, int], list[str]] = defaultdict(list)
    for p in body.ports:
        if not p.enabled:
            continue
        key = (p.host.strip().lower(), p.port)
        by_ep[key].append(p.service_name)
    conflicts: list[str] = []
    for (host, port), names in by_ep.items():
        if len(names) > 1:
            conflicts.append(f"Duplicate enabled endpoint {host}:{port} for {', '.join(names)}")
    if conflicts:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(conflicts))
    return body
