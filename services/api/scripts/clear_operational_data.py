#!/usr/bin/env python3
"""Clear operational data for a customer (keeps sites, users, customer row).

Run inside the API container (WORKDIR /app):

  docker compose exec api python scripts/clear_operational_data.py

Optional: CLEAR_CUSTOMER_ID=<uuid> to target a specific tenant; otherwise the oldest customer by created_at is used.
"""

from __future__ import annotations

import os
import sys
import uuid

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.customer import Customer
from app.services.tenant_data_clear import clear_operational_data_except_sites


def main() -> None:
    db = SessionLocal()
    try:
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
