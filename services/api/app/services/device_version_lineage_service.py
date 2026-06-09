"""Persisted device version timeline (§13 / §15) + immutable device_versions (Phase 3)."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.device_version import DeviceVersion
from app.models.device_version_lineage import DeviceVersionLineage
from app.schemas.device import VersionLineageResponse, VersionLineageVersionItem

log = logging.getLogger(__name__)


def bump_device_version_monotonic_label(label: str) -> str:
    """Next label when the platform auto-mints a version (numeric or trailing numeric segment)."""
    s = (label or "").strip() or "1"
    if s.isdigit():
        return str(int(s, 10) + 1)
    m = re.search(r"^(.*?)(\d+)$", s)
    if m:
        prefix, num = m.group(1), m.group(2)
        return f"{prefix}{int(num, 10) + 1}"
    return f"{s}-2"


def kpi_snapshot_from_footprint_dict(fp: dict[str, Any]) -> dict[str, Any]:
    ing = fp.get("ingestion") or {}
    dash = fp.get("dashboard") or {}
    ep = fp.get("endpoint") or {}
    scrub = fp.get("scrubber") or {}
    return {
        "footprint_status": fp.get("status"),
        "ingestion.last_ingested_at": ing.get("last_ingested_at"),
        "ingestion.ingest_age_sec": ing.get("ingest_age_sec"),
        "dashboard.count": dash.get("count"),
        "endpoint.status": ep.get("status"),
        "scrubber.associated": scrub.get("associated"),
        "scrubber.status": scrub.get("status"),
    }


def _lineage_metadata_from_device(device: Device) -> dict[str, Any]:
    return {
        "version_status": device.version_status,
        "firmware_version": device.firmware_version,
        "firmware_channel": device.firmware_channel,
        "ota_supported": device.ota_supported,
        "rollback_supported": device.rollback_supported,
    }


def event_type_for_trigger(trigger_code: str) -> str:
    if trigger_code == "bootstrap":
        return "device_registered"
    return "metadata_updated"


def _version_source_for_trigger(trigger_code: str) -> str:
    if trigger_code == "explicit":
        return "manual"
    if trigger_code == "ingest_shape":
        return "system"
    return "system"


def _latest_device_version_for_label(db: Session, device_id: uuid.UUID, version_label: str) -> DeviceVersion | None:
    return db.execute(
        select(DeviceVersion)
        .where(DeviceVersion.device_id == device_id, DeviceVersion.version_label == version_label)
        .order_by(DeviceVersion.created_at.desc(), DeviceVersion.id.desc())
        .limit(1)
    ).scalar_one_or_none()


_MISSING = object()


def _create_device_version_snapshot(
    db: Session,
    device: Device,
    *,
    version_label: str,
    previous_device_version_id: uuid.UUID | None,
    version_source: str,
    created_by: uuid.UUID | None,
    routing_lane: str = "shared",
    compatibility: str | None = None,
    config_version: str | None = None,
    software_version: str | None = None,
    snapshot_firmware_version: str | None = None,
    display_version_label: str | None = None,
    system_version_key: str | None = None,
    status: str | None = None,
    activated_at: datetime | None | object = _MISSING,
) -> DeviceVersion:
    now = datetime.now(timezone.utc)
    disp = (display_version_label or "").strip() or (version_label or "").strip() or "1"
    status_eff = (status or device.version_status or "active")[:32]
    if activated_at is _MISSING:
        activated_eff: datetime | None = now
    else:
        activated_eff = activated_at  # type: ignore[assignment]
    sfv = (snapshot_firmware_version or "").strip()[:128] if snapshot_firmware_version else ""
    row_fw = sfv or device.firmware_version
    row = DeviceVersion(
        id=uuid.uuid4(),
        device_id=device.id,
        version_label=version_label,
        system_version_key=(system_version_key.strip()[:128] if system_version_key and system_version_key.strip() else None),
        display_version_label=disp[:64],
        resolved_device_id=None,
        previous_device_version_id=previous_device_version_id,
        firmware_version=row_fw,
        hardware_version=None,
        config_version=config_version,
        endpoint_version=None,
        scrubber_version=None,
        schema_version=None,
        manifest_hash=None,
        software_version=software_version,
        version_source=version_source,
        firmware_channel=device.firmware_channel or "stable",
        status=status_eff,
        created_at=now,
        created_by=created_by,
        activated_at=activated_eff,
        deprecated_at=None,
        routing_lane=routing_lane,
        compatibility=compatibility,
    )
    db.add(row)
    db.flush()
    return row


def ensure_device_version_row_for_label(
    db: Session,
    device: Device,
    *,
    version_label: str,
    version_source: str = "system",
    created_by: uuid.UUID | None = None,
    previous_device_version_id: uuid.UUID | None = None,
) -> DeviceVersion:
    """Idempotent: return existing row for this device+label if present, else insert one snapshot."""
    existing = _latest_device_version_for_label(db, device.id, version_label)
    if existing:
        return existing
    return _create_device_version_snapshot(
        db,
        device,
        version_label=version_label,
        previous_device_version_id=previous_device_version_id,
        version_source=version_source,
        created_by=created_by,
    )


def ensure_bootstrap_lineage_row(db: Session, device: Device, *, fp: dict[str, Any] | None = None) -> None:
    """If no lineage rows exist for this device, insert bootstrap + link ``device_versions``.

    Uses ``flush`` only; caller must ``commit()`` (Phase 1).
    """
    exists_id = db.scalar(select(DeviceVersionLineage.id).where(DeviceVersionLineage.device_id == device.id).limit(1))
    if exists_id:
        return
    vlabel = (device.device_version or "").strip() or "1"
    recorded = device.updated_at or device.created_at
    kpi = kpi_snapshot_from_footprint_dict(fp) if fp else None
    dv = ensure_device_version_row_for_label(db, device, version_label=vlabel, version_source="system", created_by=None)
    row = DeviceVersionLineage(
        id=uuid.uuid4(),
        device_id=device.id,
        version_label=vlabel,
        recorded_at=recorded,
        trigger_code="bootstrap",
        superseded_by_label=None,
        ota_external_ref=None,
        kpi_snapshot=kpi,
        metadata_=_lineage_metadata_from_device(device),
        event_type="device_registered",
        source_type="system",
        source_id=None,
        status="completed",
        previous_device_version_id=None,
        target_device_version_id=dv.id,
        ota_campaign_id=None,
        payload_json=None,
        created_by=None,
    )
    db.add(row)
    db.flush()
    log.info("device_version_lineage bootstrap inserted device_id=%s", device.id)


def record_version_lineage_transition(
    db: Session,
    device: Device,
    *,
    previous_label: str,
    new_label: str,
    trigger_code: str,
    kpi_snapshot: dict[str, Any] | None,
    ota_external_ref: str | None = None,
    created_by: uuid.UUID | None = None,
    source_type: str | None = None,
    event_type: str | None = None,
    payload_json: dict[str, Any] | None = None,
    snapshot_config_version: str | None = None,
    snapshot_software_version: str | None = None,
) -> None:
    """Mark prior head row superseded and append a new lineage row + immutable ``device_versions`` row."""
    if previous_label == new_label:
        return
    now = datetime.now(timezone.utc)
    ev_type = event_type or event_type_for_trigger(trigger_code)
    src = source_type or "api"
    prev_dv = _latest_device_version_for_label(db, device.id, previous_label)
    prev_id = prev_dv.id if prev_dv else None
    new_dv = _create_device_version_snapshot(
        db,
        device,
        version_label=new_label,
        previous_device_version_id=prev_id,
        version_source=_version_source_for_trigger(trigger_code),
        created_by=created_by,
        config_version=snapshot_config_version,
        software_version=snapshot_software_version,
        display_version_label=new_label,
        system_version_key=new_label,
    )
    last = db.execute(
        select(DeviceVersionLineage)
        .where(DeviceVersionLineage.device_id == device.id)
        .order_by(DeviceVersionLineage.recorded_at.desc(), DeviceVersionLineage.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if last and last.superseded_by_label is None and last.version_label != new_label:
        last.superseded_by_label = new_label
        db.add(last)
    meta = _lineage_metadata_from_device(device)
    db.add(
        DeviceVersionLineage(
            id=uuid.uuid4(),
            device_id=device.id,
            version_label=new_label,
            recorded_at=now,
            trigger_code=trigger_code,
            superseded_by_label=None,
            ota_external_ref=(ota_external_ref.strip()[:255] if ota_external_ref and ota_external_ref.strip() else None),
            kpi_snapshot=kpi_snapshot,
            metadata_=meta,
            event_type=ev_type,
            source_type=src,
            source_id=None,
            status="completed",
            previous_device_version_id=prev_id,
            target_device_version_id=new_dv.id,
            ota_campaign_id=None,
            payload_json=payload_json,
            created_by=created_by,
        )
    )
    db.flush()
    log.info(
        "device_version_lineage trigger=%s device_id=%s %s -> %s",
        trigger_code,
        device.id,
        previous_label,
        new_label,
    )


def append_lineage_event(
    db: Session,
    device: Device,
    *,
    version_label: str,
    trigger_code: str,
    event_type: str,
    source_type: str,
    status: str,
    payload_json: dict[str, Any] | None,
    created_by: uuid.UUID | None,
    ota_campaign_id: uuid.UUID | None,
    ota_external_ref: str | None,
    target_device_version_id: uuid.UUID | None,
    previous_device_version_id: uuid.UUID | None,
    kpi_snapshot: dict[str, Any] | None = None,
) -> None:
    """Append a lineage row without superseding the prior head (e.g. OTA terminal status)."""
    now = datetime.now(timezone.utc)
    meta = _lineage_metadata_from_device(device)
    db.add(
        DeviceVersionLineage(
            id=uuid.uuid4(),
            device_id=device.id,
            version_label=version_label,
            recorded_at=now,
            trigger_code=trigger_code,
            superseded_by_label=None,
            ota_external_ref=(ota_external_ref.strip()[:255] if ota_external_ref and ota_external_ref.strip() else None),
            kpi_snapshot=kpi_snapshot,
            metadata_=meta,
            event_type=event_type,
            source_type=source_type,
            source_id=None,
            status=status,
            previous_device_version_id=previous_device_version_id,
            target_device_version_id=target_device_version_id,
            ota_campaign_id=ota_campaign_id,
            payload_json=payload_json,
            created_by=created_by,
        )
    )
    db.flush()


def record_explicit_version_change(
    db: Session,
    device: Device,
    *,
    previous_label: str,
    new_label: str,
    kpi_snapshot: dict[str, Any] | None,
    created_by: uuid.UUID | None = None,
) -> None:
    """Mark prior head row superseded and append a new lineage entry (explicit version / PATCH)."""
    record_version_lineage_transition(
        db,
        device,
        previous_label=previous_label,
        new_label=new_label,
        trigger_code="explicit",
        kpi_snapshot=kpi_snapshot,
        ota_external_ref=None,
        created_by=created_by,
        source_type="api",
        event_type=None,
        payload_json=None,
    )


def build_version_lineage_response(db: Session, device: Device, fp: dict[str, Any]) -> VersionLineageResponse:
    ensure_bootstrap_lineage_row(db, device, fp=fp)

    rows = list(
        db.scalars(
            select(DeviceVersionLineage)
            .where(DeviceVersionLineage.device_id == device.id)
            .order_by(DeviceVersionLineage.recorded_at.asc(), DeviceVersionLineage.id.asc())
        ).all()
    )

    cur_label = (device.device_version or "").strip() or "1"
    live_kpi = kpi_snapshot_from_footprint_dict(fp)

    versions: list[VersionLineageVersionItem] = []
    kpi_by_version: dict[str, dict[str, Any]] = {}
    all_keys: set[str] = set()

    for i, r in enumerate(rows):
        is_current = (i == len(rows) - 1) and (r.version_label == cur_label)
        snap = dict(r.kpi_snapshot) if r.kpi_snapshot else {}
        if is_current:
            snap = {**snap, **live_kpi}
        for k in snap:
            all_keys.add(k)
        kpi_by_version[r.version_label] = snap
        meta = dict(r.metadata_ or {})
        versions.append(
            VersionLineageVersionItem(
                id=str(r.id),
                version_label=r.version_label,
                is_current=is_current,
                recorded_at=r.recorded_at,
                trigger_code=r.trigger_code,
                superseded_by_label=r.superseded_by_label,
                ota_external_ref=r.ota_external_ref,
                metadata=meta,
                event_type=r.event_type,
                source_type=r.source_type,
                status=r.status,
                target_device_version_id=str(r.target_device_version_id) if r.target_device_version_id else None,
                previous_device_version_id=str(r.previous_device_version_id)
                if r.previous_device_version_id
                else None,
            )
        )

    if not all_keys:
        all_keys = set(live_kpi.keys())

    return VersionLineageResponse(
        device_id=str(device.id),
        versions=versions,
        kpi_metric_keys=sorted(all_keys),
        kpi_by_version=kpi_by_version,
    )
