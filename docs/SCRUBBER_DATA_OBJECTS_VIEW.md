# Scrubber: View Data Objects (compiled rows)

This document describes what the **View Data Objects** UI (`/scrubber/data-objects`) shows and how it relates to Scrubber Studio, the ingest pipeline, and Postgres.

## Not the same as Scrubber Studio preview

“Online” in Studio and **Compile preview** run the transform inside the **API** only — they do **not** insert rows into the data objects table. The View Data Objects table lists rows written by the **worker-scrubber** service after Kafka handoff.

## Pipeline (compiled `data_objects` rows)

1. New raw archived → Kafka `raw.ingest`
2. **worker-ingest** (must emit `scrubber.input`; set env `KAFKA_EMIT_SCRUBBER_INPUT=true`)
3. **worker-scrubber** consumes scrubber input and writes Postgres `data_objects`
4. Publish/save mapping in Studio only updates configuration; the **next** ingested raw after that triggers a new row.

If the list stays empty while ingest appears to work, check that both workers are running and inspect **worker-ingest** logs for `scrubber_input_emitted` and **worker-scrubber** for `data_object_insert`.

## UI behavior

- To preview transforms against archived raw bytes, use **Pick raw sample** (`/scrubber/raw-select`).
- The table can list **every** compiled object or **one latest row per object name** (per device), controlled by **Table contents**.
- Rows are grouped by **calendar day (UTC)** of `created_at` (newest days first).
- **Last processed** in the table refers to the row with the newest `updated_at` for the current device filter; details can be expanded inline in the table.
