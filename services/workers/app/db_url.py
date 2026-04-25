"""Postgres DSN from env for workers. Dependency-free to avoid ingest ↔ liveness import cycles."""

from __future__ import annotations

import os


def db_url() -> str:
    u = os.environ.get("METADATA_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    return u.replace("postgresql+psycopg2://", "postgresql://")
