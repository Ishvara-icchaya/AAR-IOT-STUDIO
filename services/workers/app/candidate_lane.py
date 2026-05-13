"""Candidate-lane routing for ingest → latest_device_state (Phase 7, worker)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from psycopg2.extensions import cursor as Cursor
from psycopg2.extras import Json


def fetch_blocking_device_version_id(cur: Cursor, resolved_device_id: str) -> str | None:
    cur.execute(
        """
        SELECT dv.id::text
        FROM resolved_devices rd
        JOIN endpoints ep ON ep.id = rd.endpoint_id
        JOIN device_endpoints de ON de.id = ep.device_endpoint_id
        JOIN device_versions dv ON dv.device_id = de.device_id
        WHERE rd.id = %s::uuid
          AND dv.routing_lane = 'candidate'
          AND dv.status NOT IN ('failed', 'rolled_back', 'deprecated')
        LIMIT 1
        """,
        (resolved_device_id,),
    )
    row = cur.fetchone()
    return str(row[0]) if row else None


def upsert_candidate_latest_device_state(
    cur: Cursor,
    *,
    resolved_device_id: str,
    device_version_id: str,
    customer_id: str,
    site_id: str,
    identity_json: dict[str, Any],
    display_json: dict[str, Any],
    kpi_json: dict[str, Any],
    health_json: dict[str, Any] | None,
    location_json: dict[str, Any] | None,
    scrubbed_event_id: str | None,
    updated_at: datetime,
) -> None:
    cur.execute(
        """
        INSERT INTO candidate_latest_device_state (
          id, resolved_device_id, device_version_id, customer_id, site_id,
          identity_json, display_json, kpi_json, health_json, location_json,
          system_json,
          scrubbed_event_id, updated_at
        ) VALUES (
          gen_random_uuid(), %s::uuid, %s::uuid, %s::uuid, %s::uuid,
          %s, %s, %s, %s, %s,
          %s,
          %s, %s
        )
        ON CONFLICT (resolved_device_id) DO UPDATE SET
          device_version_id = EXCLUDED.device_version_id,
          identity_json = EXCLUDED.identity_json,
          display_json = EXCLUDED.display_json,
          kpi_json = EXCLUDED.kpi_json,
          health_json = EXCLUDED.health_json,
          location_json = EXCLUDED.location_json,
          scrubbed_event_id = EXCLUDED.scrubbed_event_id,
          updated_at = EXCLUDED.updated_at
        """,
        (
            resolved_device_id,
            device_version_id,
            customer_id,
            site_id,
            Json(identity_json),
            Json(display_json),
            Json(kpi_json),
            Json(health_json) if health_json else None,
            Json(location_json) if location_json else None,
            Json({}),
            scrubbed_event_id,
            updated_at,
        ),
    )
