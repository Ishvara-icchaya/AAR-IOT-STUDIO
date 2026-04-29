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
      <div className="dashboard2-page__head dashboard2-page__head--split">
        <div>
          <h1>Edit</h1>
          <p className="dash-widget__muted">
            Classic builder stays on <Link to={`/dashboard/${dashboard.id}/edit`}>/dashboard/{dashboard.id}/edit</Link>{" "}
            (unchanged).
          </p>
        </div>
        <nav className="dashboard2-page__nav" aria-label="Editor actions">
          <Link className="aar-btn aar-btn--primary dm-btn dm-btn--primary" to={`/dashboard2/${dashboard.id}/live`}>
            Open live
          </Link>
          <Link className="aar-btn aar-btn--outline dm-btn dm-btn--outline" to={`/dashboard2/${dashboard.id}/preview`}>
            Preview
          </Link>
          <Link className="aar-btn aar-btn--outline dm-btn dm-btn--outline" to="/dashboard2/review">
            Review hub
          </Link>
        </nav>
      </div>
      <DashboardDesignerShell dashboard={dashboard} onChange={setDashboard} />
    </section>
  );
}
