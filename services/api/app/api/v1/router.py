import logging

from fastapi import APIRouter

from app.api.v1 import admin_llm_config, admin_ports, trends
from app.api.v1 import (
    administration,
    ai,
    alerts,
    auth,
    control_plane_audit,
    dashboard,
    device_versions,
    permissions_me,
    roles_catalog,
    site_members,
    data_pulls,
    device_endpoints,
    device_objects,
    devices,
    endpoints,
    enterprise_dashboard,
    ingest,
    monitoring,
    published_services,
    raw_data_objects,
    result_objects,
    scrubber,
    simulations,
    static_ingestion,
    workflow,
    workspace,
)

log = logging.getLogger(__name__)

admin_router = APIRouter()
admin_router.include_router(admin_llm_config.router)
admin_router.include_router(admin_ports.router)

api_router = APIRouter()

_BASE_MOUNT: list[tuple[APIRouter, str, str]] = [
    (auth.router, "/auth", "auth"),
    (roles_catalog.router, "/roles", "roles"),
    (permissions_me.router, "/permissions", "permissions"),
    (site_members.router, "/sites", "sites"),
    (ingest.router, "/ingest", "ingest"),
    (raw_data_objects.router, "/raw-data-objects", "raw-data-objects"),
    (devices.router, "/devices", "devices"),
    (device_versions.router, "/device-versions", "device-versions"),
    (simulations.router, "/simulations", "simulations"),
    (control_plane_audit.router, "/audit", "audit"),
    (device_endpoints.router, "/device-endpoints", "device-endpoints"),
    (endpoints.router, "/endpoints", "endpoints"),
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
    (workspace.router, "/workspace", "workspace"),
    (admin_router, "/admin", "admin"),
]

_MOUNT: list[tuple[APIRouter, str, str]] = list(_BASE_MOUNT)

for router, prefix, tag in _MOUNT:
    api_router.include_router(router, prefix=prefix, tags=[tag])
    log.debug("api v1 mounted tag=%s prefix=%s", tag, prefix)

api_router.include_router(trends.router, prefix="/trends", tags=["trends"])
log.debug("api v1 mounted tag=trends prefix=/trends")
