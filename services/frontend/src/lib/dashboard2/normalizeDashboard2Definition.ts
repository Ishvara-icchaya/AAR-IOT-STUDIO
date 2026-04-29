import type { DashboardReadDTO } from "@/types/dashboard";
import type { DashboardDefinition2 } from "@/types/dashboard2";
import { migrateLegacyDashboardToGrid } from "./migrateLegacyDashboardToGrid";

export function normalizeDashboard2Definition(source: DashboardReadDTO): DashboardDefinition2 {
  if (source.schema_version === 2 && source.layouts_json && source.widgets_json) {
    return {
      id: source.id,
      name: source.name,
      description: source.description ?? undefined,
      customerId: source.customer_id,
      siteId: source.site_id ?? undefined,
      version: 2,
      status: (source.status as DashboardDefinition2["status"]) || "draft",
      layouts: source.layouts_json as DashboardDefinition2["layouts"],
      widgets: source.widgets_json as DashboardDefinition2["widgets"],
      createdAt: source.created_at,
      updatedAt: source.updated_at,
    };
  }
  return migrateLegacyDashboardToGrid(source);
}
