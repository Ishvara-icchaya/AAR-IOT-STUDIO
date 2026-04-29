import { Navigate, useParams } from "react-router-dom";
import { DashboardLiveScreen2 } from "@/components/dashboard2/DashboardLiveScreen";
import { DASHBOARD2_ENABLED } from "@/lib/featureFlags";
import { useDashboard2Load } from "./useDashboard2Load";

export function Dashboard2LivePage() {
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const { dashboard, loading, error } = useDashboard2Load(dashboardId);
  if (!DASHBOARD2_ENABLED) return <Navigate to="/dashboard/list" replace />;
  if (loading) return <p className="dm-empty">Loading Dashboard2 live…</p>;
  if (error) return <p className="dm-empty">{error}</p>;
  if (!dashboard) return <p className="dm-empty">Dashboard not found.</p>;
  return <DashboardLiveScreen2 dashboard={dashboard} />;
}
