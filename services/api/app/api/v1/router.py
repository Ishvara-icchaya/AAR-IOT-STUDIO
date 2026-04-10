import logging

from fastapi import APIRouter

from app.api.v1 import admin_llm_config, admin_ports
from app.api.v1 import (
    administration,
    ai,
    alerts,
    auth,
    dashboard,
    data_pulls,
    device_endpoints,
    device_objects,
    devices,
    enterprise_dashboard,
    ingest,
    monitoring,
    published_services,
    raw_data_objects,
    result_objects,
    scrubber,
    static_ingestion,
    workflow,
)

log = logging.getLogger(__name__)

admin_router = APIRouter()
admin_router.include_router(admin_llm_config.router)
admin_router.include_router(admin_ports.router)

api_router = APIRouter()

_MOUNT = (
    (auth.router, "/auth", "auth"),
    (ingest.router, "/ingest", "ingest"),
    (raw_data_objects.router, "/raw-data-objects", "raw-data-objects"),
    (devices.router, "/devices", "devices"),
    (device_endpoints.router, "/device-endpoints", "device-endpoints"),
    (device_objects.router, "/device-objects", "device-objects"),
    (data_pulls.router, "/data-pulls", "data-pulls"),
    (scrubber.router, "/scrubber", "scrubber"),
    (static_ingestion.router, "/static-ingestions", "static-ingestions"),
    (workflow.router, "/workflows", "workflows"),
    (result_objects.router, "/result-objects", "result-objects"),
    (dashboard.router, "/dashboards", "dashboards"),
    (enterprise_dashboard.router, "/enterprise-dashboard", "enterprise-dashboard"),
    (alerts.router, "/alerts", "alerts"),
    (ai.router, "/ai", "ai"),
    (monitoring.router, "/monitoring", "monitoring"),
    (published_services.router, "/published-services", "published-services"),
    (administration.router, "/administration", "administration"),
    (admin_router, "/admin", "admin"),
)

for router, prefix, tag in _MOUNT:
    api_router.include_router(router, prefix=prefix, tags=[tag])
    log.debug("api v1 mounted tag=%s prefix=%s", tag, prefix)
