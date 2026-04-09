"""Monitoring-driven alert emission.

``GET /monitoring/deep`` applies per-check Redis ``SET … NX`` cooldowns (see ``monitoring.py``).
Other alert paths can use ``alert_dedupe.redis_cooldown_allows_emit`` or publish/workflow-specific helpers.
"""

from __future__ import annotations
