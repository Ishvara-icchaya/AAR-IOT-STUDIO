import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { listDashboards } from "@/api/dashboard";
import type { DashboardListItemDTO } from "@/types/dashboard";
import { DASHBOARD2_DEMO_DASHBOARD_NAME } from "@/lib/dashboard2/demoConstants";
import { DASHBOARD2_ENABLED } from "@/lib/featureFlags";
import { AarButton } from "@/components/system/AarButton";
import "@/components/dashboard2/dashboard2.css";

function formatUpdated(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function Dashboard2ReviewPage() {
  const [items, setItems] = useState<DashboardListItemDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listDashboards();
      setItems(res?.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboards");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((d) => d.name.toLowerCase().includes(s) || d.id.toLowerCase().includes(s));
  }, [items, q]);

  if (!DASHBOARD2_ENABLED) return <Navigate to="/dashboard/list" replace />;

  return (
    <section className="dashboard2-page dashboard2-review-page">
      <header className="dashboard2-review-page__hero">
        <div>
          <p className="dashboard2-review-page__eyebrow">Dashboard 2.0</p>
          <h1>Review hub</h1>
          <p className="dashboard2-review-page__lede">
            Pick a dashboard to open the grid runtime, designer, or preview. Production dashboards continue to use{" "}
            <Link to="/dashboard/list">the classic list and editor</Link> at <code>/dashboard/:id/edit</code> (unchanged).
          </p>
        </div>
        <div className="dashboard2-review-page__hero-actions">
          <AarButton variant="outline" type="button" onClick={() => void load()} disabled={loading}>
            Refresh list
          </AarButton>
          <Link className="aar-btn aar-btn--outline dm-btn dm-btn--outline" to="/dashboard/list">
            All dashboards (legacy)
          </Link>
        </div>
      </header>

      <div className="dashboard2-review-page__callout">
        <strong>Seeded demo</strong>
        <p>
          After API startup, a draft named <em>{DASHBOARD2_DEMO_DASHBOARD_NAME}</em> is created when at least one site,
          endpoint, and layout validation succeed. Use it for fleet / map / table smoke tests when you have{" "}
          <code>latest_device_state</code> data.
        </p>
      </div>

      <div className="dashboard2-review-page__toolbar">
        <label className="dashboard2-review-page__search">
          <span className="dm-sr-only">Search dashboards</span>
          <input
            className="dm-search-input"
            placeholder="Search by name or id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      {loading ? <p className="dashboard2-review-page__status">Loading dashboards…</p> : null}
      {error ? (
        <p className="dashboard2-review-page__status dashboard2-review-page__status--error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && !error ? (
        <ul className="dashboard2-review-page__list">
          {filtered.map((d) => {
            const isDemo = d.name === DASHBOARD2_DEMO_DASHBOARD_NAME;
            return (
              <li key={d.id} className={`dashboard2-review-page__row ${isDemo ? "is-demo" : ""}`}>
                <div className="dashboard2-review-page__row-main">
                  <div className="dashboard2-review-page__row-title">
                    <span className="dashboard2-review-page__name">{d.name}</span>
                    {isDemo ? <span className="dashboard2-review-page__pill">Demo</span> : null}
                  </div>
                  <div className="dashboard2-review-page__row-meta">
                    <code className="dashboard2-review-page__id">{d.id}</code>
                    <span>{d.status}</span>
                    <span>Updated {formatUpdated(d.updated_at)}</span>
                  </div>
                </div>
                <div className="dashboard2-review-page__row-actions">
                  <Link className="aar-btn aar-btn--primary dm-btn dm-btn--primary" to={`/dashboard2/${d.id}/live`}>
                    Open live
                  </Link>
                  <Link className="aar-btn aar-btn--outline dm-btn dm-btn--outline" to={`/dashboard2/${d.id}/edit`}>
                    Edit
                  </Link>
                  <Link className="aar-btn aar-btn--outline dm-btn dm-btn--outline" to={`/dashboard2/${d.id}/preview`}>
                    Preview
                  </Link>
                  <Link
                    className="aar-btn aar-btn--outline dm-btn dm-btn--outline dashboard2-review-page__legacy-link"
                    to={`/dashboard/${d.id}/edit`}
                    title="Classic builder (unchanged route)"
                  >
                    Legacy edit
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!loading && !error && filtered.length === 0 ? (
        <p className="dashboard2-review-page__status">No dashboards match this filter.</p>
      ) : null}
    </section>
  );
}
