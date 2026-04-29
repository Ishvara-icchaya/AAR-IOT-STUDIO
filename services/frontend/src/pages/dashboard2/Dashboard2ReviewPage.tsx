import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { DASHBOARD2_ENABLED } from "@/lib/featureFlags";
import "@/components/dashboard2/dashboard2.css";

export function Dashboard2ReviewPage() {
  const [dashboardId, setDashboardId] = useState("");
  if (!DASHBOARD2_ENABLED) return <Navigate to="/dashboard/list" replace />;
  return (
    <section className="dashboard2-page">
      <div className="dashboard2-page__head">
        <h1>Dashboard2 Review</h1>
        <p className="dash-widget__muted">Enter dashboard id to open dashboard2 routes safely.</p>
      </div>
      <div className="dashboard2-review-box">
        <input
          className="dm-search-input"
          placeholder="Dashboard ID"
          value={dashboardId}
          onChange={(e) => setDashboardId(e.target.value)}
        />
        <div className="dashboard2-review-box__links">
          <Link to={dashboardId ? `/dashboard2/${dashboardId}/edit` : "#"}>Open edit</Link>
          <Link to={dashboardId ? `/dashboard2/${dashboardId}/live` : "#"}>Open live</Link>
          <Link to={dashboardId ? `/dashboard2/${dashboardId}/preview` : "#"}>Open preview</Link>
        </div>
      </div>
    </section>
  );
}
