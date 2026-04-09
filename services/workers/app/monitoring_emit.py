"""Helpers to emit monitoring-related alerts from workers/samplers (Phase 2).

UI-facing GET /api/v1/monitoring/* routes stay read-only. Use the canonical
`emit_alert(...)` from the API service when running probe jobs that should
notify operators.
"""

from __future__ import annotations
