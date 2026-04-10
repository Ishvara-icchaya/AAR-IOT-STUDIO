/** Operational main nav + administration routes (spec: Navigation and Page Shell). */

export type NavChild = { to: string; label: string; end?: boolean };

export type NavGroup = {
  id: string;
  label: string;
  items: NavChild[];
};

export const MAIN_NAV_GROUPS: NavGroup[] = [
  {
    id: "devices",
    label: "Devices",
    items: [
      { to: "/devices/register", label: "Register Devices" },
      { to: "/devices/manage", label: "Manage Devices" },
      { to: "/devices/raw", label: "Raw Data" },
    ],
  },
  {
    id: "scrubber",
    label: "Scrubber",
    items: [
      { to: "/scrubber/data-objects", label: "View Data Objects" },
      { to: "/scrubber/stale-ingestion", label: "Mapping without ingestion" },
      { to: "/scrubber/raw-select", label: "Pick raw sample" },
    ],
  },
  {
    id: "workflow",
    label: "Workflow",
    items: [
      { to: "/workflow/list", label: "View Workflows" },
      { to: "/workflow/create", label: "Create Workflow" },
    ],
  },
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
      { to: "/enterprise-dashboard", label: "Primary Dashboard", end: true },
      { to: "/iot-dashboard", label: "Operations Console" },
    ],
  },
  {
    id: "alerts",
    label: "Alerts",
    items: [{ to: "/alerts", label: "Unified Alerts" }],
  },
  {
    id: "ai",
    label: "AI",
    items: [{ to: "/enterprise-ai", label: "Enterprise AI" }],
  },
  {
    id: "published",
    label: "Published",
    items: [{ to: "/published-services", label: "Start/Stop Publishing" }],
  },
];

export const ADMIN_NAV_ITEMS: NavChild[] = [
  { to: "/administration/users", label: "Create Users" },
  { to: "/administration/sites", label: "Create Sites" },
  { to: "/administration/monitoring", label: "Monitoring" },
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
  for (const g of MAIN_NAV_GROUPS) {
    if (g.id === "dashboard" && pathname.startsWith("/dashboard/")) return "dashboard";
    if (g.id === "workflow" && pathname.startsWith("/workflow/")) return "workflow";
    if (g.id === "alerts" && pathname.startsWith("/alerts")) return "alerts";
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
  if (pathname.startsWith("/alerts/")) return "Alert detail";
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
