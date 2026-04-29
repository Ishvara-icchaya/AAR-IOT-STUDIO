/** Operational main nav + administration routes (spec: Navigation and Page Shell). */
import { DASHBOARD2_ENABLED } from "@/lib/featureFlags";

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
    label: "Manage Endpoints",
    to: "/devices/register",
    alsoActiveOn: ["/devices/manage", "/devices/raw", "/devices/ingest"],
  },
  {
    id: "raw-sample",
    label: "Raw sample",
    to: "/scrubber/raw-select",
    alsoActiveOn: ["/scrubber/raw-select", "/scrubber/create"],
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
      ...(DASHBOARD2_ENABLED ? [{ to: "/dashboard2/review", label: "Dashboard2 Review" }] : []),
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
  { to: "/administration/sites", label: "Sites" },
  { to: "/administration/clear-data", label: "Clear operational data" },
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
  for (const link of MAIN_NAV_FLAT_LINKS) {
    if (pathMatchesFlatLink(pathname, link)) return link.id;
  }
  for (const g of MAIN_NAV_GROUPS) {
    if (
      g.id === "dashboard" &&
      (pathname === "/dashboard" || pathname.startsWith("/dashboard/") || pathname.startsWith("/dashboard2/"))
    )
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
  if (pathname === "/devices/manage") return "Manage device";
  if (pathname === "/devices/raw") return "Raw Data";
  if (pathname === "/devices/ingest") return "Manage Endpoints";
  if (pathname === "/enterprise-ai") return "Enterprise AI";
  if (pathname === "/dashboard" || pathname === "/enterprise-dashboard") return "Primary Dashboard";
  if (pathname === "/dashboard2/review") return "Dashboard2 Review";
  if (pathname === "/administration/users") return "Users";
  if (pathname === "/administration/sites") return "Sites";
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
  if (pathname.startsWith("/dashboard2/") && pathname.endsWith("/edit")) return "Dashboard2 Edit";
  if (pathname.startsWith("/dashboard2/") && pathname.endsWith("/live")) return "Dashboard2 Live";
  if (pathname.startsWith("/dashboard2/") && pathname.endsWith("/preview")) return "Dashboard2 Preview";
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
