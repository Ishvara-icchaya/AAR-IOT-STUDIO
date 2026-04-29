import { Navigate, useParams } from "react-router-dom";
import { DashboardRuntimeGrid } from "@/components/dashboard2/DashboardRuntimeGrid";
import { DASHBOARD2_ENABLED } from "@/lib/featureFlags";
import { useDashboard2Load } from "./useDashboard2Load";

export function Dashboard2PreviewPage() {
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const { dashboard, loading, error } = useDashboard2Load(dashboardId);
  if (!DASHBOARD2_ENABLED) return <Navigate to="/dashboard/list" replace />;
  if (loading) return <p className="dm-empty">Loading Dashboard2 preview…</p>;
  if (error) return <p className="dm-empty">{error}</p>;
  if (!dashboard) return <p className="dm-empty">Dashboard not found.</p>;
  return (
    <section className="dashboard2-page">
      <div className="dashboard2-page__head">
        <h1>Dashboard2 Preview</h1>
      </div>
      <DashboardRuntimeGrid dashboard={dashboard} mode="preview" />
    </section>
  );
}
