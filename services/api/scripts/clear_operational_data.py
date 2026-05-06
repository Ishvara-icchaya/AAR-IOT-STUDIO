#!/usr/bin/env python3
"""Clear operational data for a customer (keeps sites, users, customer row).

Run inside the API container (WORKDIR /app):

  docker compose exec api python scripts/clear_operational_data.py

Optional: CLEAR_CUSTOMER_ID=<uuid> to target a specific tenant; otherwise the oldest customer by created_at is used.

Rollback / v8 recovery: set CLEAR_ALL_CUSTOMERS=1 to clear operational data for every customer (same
semantics as a single-tenant clear, repeated per row in ``customers``). Use with the repo rollback script.
"""

from __future__ import annotations

import os
import sys
import uuid

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.customer import Customer
from app.services.tenant_data_clear import clear_operational_data_except_sites


def _clear_all_customers_if_requested(db) -> bool:
    """If CLEAR_ALL_CUSTOMERS is set, clear every tenant and return True (caller should stop)."""
    clear_all = os.environ.get("CLEAR_ALL_CUSTOMERS", "").strip().lower() in ("1", "true", "yes")
    if not clear_all:
        return False
    ids = list(db.scalars(select(Customer.id).order_by(Customer.created_at.asc())))
    if not ids:
        print("No customer row found.", file=sys.stderr)
        sys.exit(1)
    for customer_id in ids:
        stats = clear_operational_data_except_sites(db, customer_id)
        db.commit()
        print("Cleared operational data for customer", customer_id)
        for k, v in sorted(stats.items()):
            print(f"  {k}: {v}")
    return True


def main() -> None:
    db = SessionLocal()
    try:
        if _clear_all_customers_if_requested(db):
            return
        cid = os.environ.get("CLEAR_CUSTOMER_ID")
        if cid:
            customer_id = uuid.UUID(cid.strip())
        else:
            row = db.scalars(select(Customer).order_by(Customer.created_at.asc()).limit(1)).first()
            if not row:
                print("No customer row found.", file=sys.stderr)
                sys.exit(1)
            customer_id = row.id
        stats = clear_operational_data_except_sites(db, customer_id)
        db.commit()
        print("Cleared operational data for customer", customer_id)
        for k, v in sorted(stats.items()):
            print(f"  {k}: {v}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
