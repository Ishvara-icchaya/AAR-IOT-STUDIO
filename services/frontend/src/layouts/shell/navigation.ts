/** Operational main nav + administration routes (spec: Navigation and Page Shell). */

export type NavChild = { to: string; label: string; end?: boolean };

export type NavGroup = {
  id: string;
  label: string;
  items: NavChild[];
};

/** Single top-level links (no dropdown), rendered before module groups. */
export type MainNavFlatLink = {
  id: string;
  label: string;
  to: string;
  end?: boolean;
  /** Exact pathnames that keep this item highlighted (e.g. related device routes). */
  alsoActiveOn?: readonly string[];
};

export const MAIN_NAV_FLAT_LINKS: MainNavFlatLink[] = [
  {
    id: "devices",
    label: "Manage Devices",
    to: "/devices/register",
    alsoActiveOn: ["/devices/manage", "/devices/raw"],
  },
  {
    id: "devices-lineage",
    label: "Lineage",
    to: "/devices/lineage",
    end: true,
  },
  {
    id: "ota-campaigns",
    label: "OTA",
    to: "/devices/ota",
    alsoActiveOn: ["/devices/ota/new"],
  },
  {
    id: "register-endpoints",
    label: "Endpoints",
    to: "/devices/ingest",
    alsoActiveOn: ["/devices/ingest"],
  },
  {
    id: "raw-sample",
    label: "Raw sample",
    to: "/scrubber/raw-select",
    alsoActiveOn: ["/scrubber/raw-select"],
  },
  {
    id: "scrubber-v2",
    label: "Scrubber Pipelines",
    to: "/scrubber/v2/pipelines",
    alsoActiveOn: ["/scrubber/v2/pipelines", "/scrubber/v2/create"],
  },
  {
    id: "workflow",
    label: "Workflows",
    /** List is the hub; create/edit/test/live stay under `/workflow/…` for active highlighting. */
    to: "/workflow",
  },
  {
    id: "enterprise-ai",
    label: "Enterprise AI",
    to: "/enterprise-ai",
    end: true,
  },
];

export function pathMatchesFlatLink(pathname: string, link: MainNavFlatLink): boolean {
  if (link.alsoActiveOn?.includes(pathname)) return true;
  if (link.id === "devices" && pathname.startsWith("/devices/detail/")) return true;
  if (link.id === "ota-campaigns" && pathname.startsWith("/devices/ota/") && pathname !== "/devices/ota") return true;
  if (link.end) return pathname === link.to;
  return pathname === link.to || pathname.startsWith(`${link.to}/`);
}

export const MAIN_NAV_GROUPS: NavGroup[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    items: [
      { to: "/dashboard/list", label: "Dashboards" },
      { to: "/dashboard/create", label: "Create Dashboard" },
    ],
  },
  {
    id: "enterprise",
    label: "Enterprise",
    items: [
      { to: "/dashboard", label: "Primary Dashboard", end: true },
      { to: "/iot-dashboard", label: "Operations Console" },
    ],
  },
  {
    id: "published",
    label: "Published",
    items: [{ to: "/published-services", label: "Start/Stop Publishing" }],
  },
];

export const ADMIN_NAV_ITEMS: NavChild[] = [
  { to: "/administration/users", label: "Users" },
  { to: "/administration/site-access", label: "Site Access" },
  { to: "/administration/audit", label: "Control plane audit" },
  { to: "/administration/sites", label: "Sites" },
  { to: "/administration/clear-data", label: "Clear operational data" },
  { to: "/administration/llm-config", label: "LLM Configuration" },
  { to: "/administration/ports", label: "Configure Ports" },
  { to: "/administration/restore", label: "Restore to Default" },
];

function pathMatchesChild(pathname: string, child: NavChild): boolean {
  if (child.end) return pathname === child.to;
  return pathname === child.to || pathname.startsWith(`${child.to}/`);
}

/** True if this exact child route is active (for submenu row highlight). */
export function isChildActive(pathname: string, child: NavChild): boolean {
  if (child.end) return pathname === child.to;
  if (pathname === child.to) return true;
  if (!pathname.startsWith(`${child.to}/`)) return false;
  return true;
}

/** Main nav section id when pathname belongs to that module, or null. */
export function activeMainSectionId(pathname: string): string | null {
  for (const link of MAIN_NAV_FLAT_LINKS) {
    if (pathMatchesFlatLink(pathname, link)) return link.id;
  }
  for (const g of MAIN_NAV_GROUPS) {
    if (g.id === "dashboard" && (pathname === "/dashboard" || pathname.startsWith("/dashboard/")))
      return "dashboard";
    if (g.id === "published" && pathname.startsWith("/published-services")) return "published";
    if (g.items.some((c) => pathMatchesChild(pathname, c))) return g.id;
  }
  return null;
}

export function isAdminSectionActive(pathname: string): boolean {
  return pathname.startsWith("/administration/");
}

/** Page title from path (page bar). */
export function titleFromPath(pathname: string): string {
  if (pathname === "/iot-dashboard") return "Operations Console";
  if (pathname === "/scrubber/create") return "Scrubber Studio";
  if (pathname === "/scrubber/v2") return "Scrubber Pipelines";
  if (pathname === "/scrubber/v2/pipelines") return "Scrubber Pipelines";
  if (pathname.startsWith("/scrubber/v2")) return "Scrubber Studio 2.0";
  if (pathname === "/devices/register") return "Manage Devices";
  if (pathname === "/devices/ota" || pathname === "/devices/ota/new") return "OTA Campaigns";
  if (pathname.startsWith("/devices/ota/")) return "OTA Campaign";
  if (pathname.startsWith("/devices/detail/")) return "Device details";
  if (pathname === "/devices/lineage") return "Operational Lineage";
  if (pathname === "/devices/manage") return "Manage device";
  if (pathname === "/devices/raw") return "Raw Data";
  if (pathname.startsWith("/devices/ingest")) return "Endpoints";
  if (pathname === "/enterprise-ai") return "Enterprise AI";
  if (pathname === "/dashboard" || pathname === "/enterprise-dashboard") return "Primary Dashboard";
  if (pathname === "/administration/users") return "Users";
  if (pathname === "/administration/site-access") return "Site Access";
  if (pathname === "/administration/audit") return "Control plane audit";
  if (pathname === "/administration/sites") return "Sites";
  if (pathname.startsWith("/administration/monitoring")) return "Monitoring";
  if (pathname === "/administration/ports") return "Configure Ports";
  if (pathname === "/scrubber/raw-select") return "Raw sample";
  if (pathname === "/workflow") return "Workflows";
  if (pathname === "/workflow/list") return "Workflows";
  if (pathname === "/workflow/create") return "Create workflow";
  for (const g of MAIN_NAV_GROUPS) {
    const hit = g.items.find((i) => isChildActive(pathname, i));
    if (hit) return hit.label;
  }
  for (const a of ADMIN_NAV_ITEMS) {
    if (pathname === a.to || pathname.startsWith(`${a.to}/`)) return a.label;
  }
  if (pathname.startsWith("/dashboard/") && pathname.endsWith("/edit")) return "Edit dashboard";
  if (pathname.startsWith("/dashboard/") && pathname.endsWith("/live")) return "Live dashboard";
  if (pathname.startsWith("/workflow/") && pathname.includes("/edit")) return "Edit workflow";
  if (pathname.startsWith("/workflow/") && pathname.includes("/test")) return "Test workflow";
  if (pathname.startsWith("/workflow/") && pathname.includes("/live")) return "Live workflow";
  if (pathname === "/alerts") return "Alerts";
  if (pathname.startsWith("/alerts/")) return "Alert detail";
  if (pathname === "/published-services") return "Published services";
  if (pathname.startsWith("/published-services/")) {
    if (pathname.endsWith("/test")) return "Test published service";
    if (pathname.includes("/edit")) return "Edit published service";
    return "Published service";
  }
  return "AAR-IoT-Studio";
}

export function userIsAdmin(role: string | undefined, isSuperuser: boolean | undefined): boolean {
  return Boolean(isSuperuser || role === "admin");
}
