import { Link, Navigate, useParams } from "react-router-dom";
import { DashboardDesignerShell } from "@/components/dashboard2/DashboardDesignerShell";
import { DASHBOARD2_ENABLED } from "@/lib/featureFlags";
import { useDashboard2Load } from "./useDashboard2Load";

export function Dashboard2EditPage() {
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const { dashboard, setDashboard, loading, error } = useDashboard2Load(dashboardId);
  if (!DASHBOARD2_ENABLED) return <Navigate to="/dashboard/list" replace />;
  if (loading) return <p className="dm-empty">Loading Dashboard2 edit…</p>;
  if (error) return <p className="dm-empty">{error}</p>;
  if (!dashboard) return <p className="dm-empty">Dashboard not found.</p>;
  return (
    <section className="dashboard2-page">
      <div className="dashboard2-page__head">
        <h1>Dashboard2 Edit</h1>
        <span className="dash-widget__muted">
          Existing routes remain active. <Link to={`/dashboard/${dashboard.id}/edit`}>Open legacy editor</Link>
        </span>
      </div>
      <DashboardDesignerShell dashboard={dashboard} onChange={setDashboard} />
    </section>
  );
}
