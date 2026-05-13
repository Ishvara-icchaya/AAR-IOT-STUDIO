"""Canonical permission keys and role → permission mappings for site RBAC."""

from __future__ import annotations

ALL_PERMISSION_KEYS: tuple[str, ...] = (
    "devices.read",
    "devices.write",
    "devices.import",
    "devices.footprint.read",
    "lineage.read",
    "audit.read",
    "dashboards.read",
    "dashboards.write",
    "dashboards.publish",
    "endpoints.read",
    "endpoints.write",
    "scrubbers.read",
    "scrubbers.write",
    "workflows.read",
    "workflows.write",
    "ota.read",
    "ota.create",
    "ota.approve",
    "ota.launch",
    "ota.rollback",
    "ota.executor.read",
    "ota.executor.claim",
    "ota.executor.progress",
    "ota.executor.status",
    "device_versions.read",
    "device_versions.promote",
    "device_versions.isolate",
    "device_versions.rollback",
    "device_versions.deprecate",
    "simulation.run",
    "users.read",
    "users.invite",
    "users.assign_roles",
)

ALL_PERMISSION_KEYS_SET: frozenset[str] = frozenset(ALL_PERMISSION_KEYS)

# Assignable at site membership APIs (not customer_admin / platform_admin).
SITE_ROLE_KEYS: frozenset[str] = frozenset(
    {
        "site_admin",
        "developer",
        "device_operator",
        "device_viewer",
        "dashboard_viewer",
    }
)

ROLE_TO_PERMISSIONS: dict[str, frozenset[str]] = {
    "platform_admin": ALL_PERMISSION_KEYS_SET,
    "customer_admin": ALL_PERMISSION_KEYS_SET,
    "site_admin": ALL_PERMISSION_KEYS_SET,
    "developer": frozenset(
        {
            "devices.read",
            "lineage.read",
            "device_versions.read",
            "device_versions.deprecate",
            "endpoints.read",
            "endpoints.write",
            "scrubbers.read",
            "scrubbers.write",
            "workflows.read",
            "workflows.write",
            "simulation.run",
        }
    ),
    "device_operator": frozenset(
        {
            "devices.read",
            "devices.write",
            "devices.footprint.read",
            "lineage.read",
            "device_versions.read",
            "device_versions.promote",
            "device_versions.isolate",
            "device_versions.rollback",
            "device_versions.deprecate",
            "ota.read",
            "ota.create",
            "ota.approve",
            "ota.launch",
            "ota.rollback",
            "simulation.run",
        }
    ),
    "device_viewer": frozenset({"devices.read", "lineage.read"}),
    "dashboard_viewer": frozenset({"dashboards.read"}),
}

ROLE_METADATA: tuple[tuple[str, str, str], ...] = (
    ("platform_admin", "Platform admin", "Full platform access across all tenants."),
    ("customer_admin", "Customer admin", "All sites and users within the customer tenant."),
    ("site_admin", "Site admin", "Manage users, devices, and dashboards for a site."),
    ("developer", "Developer", "Endpoints, scrubbers, workflows, and APIs."),
    ("device_operator", "Device operator", "Devices, status, footprint, and OTA visibility."),
    ("device_viewer", "Device viewer", "Read-only device list and status."),
    ("dashboard_viewer", "Dashboard viewer", "Dashboards only (read)."),
)

PERMISSION_METADATA: tuple[tuple[str, str], ...] = (
    ("devices.read", "View devices and device status"),
    ("devices.write", "Create and update devices"),
    ("devices.import", "Bulk import devices from CSV"),
    ("devices.footprint.read", "View operational footprint and readiness"),
    ("lineage.read", "View device version lineage timeline"),
    ("audit.read", "View control-plane audit events"),
    ("dashboards.read", "View dashboards"),
    ("dashboards.write", "Create and edit dashboards"),
    ("dashboards.publish", "Publish dashboards"),
    ("endpoints.read", "View device endpoints"),
    ("endpoints.write", "Create and configure endpoints"),
    ("scrubbers.read", "View scrubber pipelines and previews"),
    ("scrubbers.write", "Create and edit scrubber pipelines"),
    ("workflows.read", "View workflows"),
    ("workflows.write", "Create and edit workflows"),
    ("ota.read", "View OTA status"),
    ("ota.create", "Create OTA jobs"),
    ("ota.approve", "Approve OTA jobs"),
    ("ota.launch", "Launch OTA rollouts"),
    ("ota.rollback", "Rollback OTA"),
    ("ota.executor.read", "Poll OTA executor work queue"),
    ("ota.executor.claim", "Claim OTA targets for execution"),
    ("ota.executor.progress", "Report non-terminal OTA progress"),
    ("ota.executor.status", "Report terminal OTA target status"),
    ("device_versions.read", "View immutable device version rows"),
    ("device_versions.promote", "Promote a device version to shared active"),
    ("device_versions.isolate", "Isolate a device version to candidate lane"),
    ("device_versions.rollback", "Rollback to the previous device version"),
    ("device_versions.deprecate", "Mark a non-production device version as deprecated"),
    ("simulation.run", "Run compatibility / replay simulation jobs"),
    ("users.read", "List site users and assignments"),
    ("users.invite", "Add existing tenant users to a site"),
    ("users.assign_roles", "Change site roles for users"),
)
