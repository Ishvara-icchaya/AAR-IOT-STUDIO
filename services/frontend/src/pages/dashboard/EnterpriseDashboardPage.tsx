import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as dashApi from "@/api/dashboard";
import type { DashboardLiveDTO } from "@/types/dashboard";
import { DashboardLiveRenderer } from "@/components/dashboard/DashboardLiveRenderer";
import { DashboardLiveToolbar } from "@/components/dashboard/DashboardLiveToolbar";
import { useOpsShellOptional } from "@/contexts/OpsShellContext";
import { parseLiveRefreshIntervalSec } from "@/lib/dashboardLiveSettings";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

export function EnterpriseDashboardPage() {
  const [payload, setPayload] = useState<DashboardLiveDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);
  const ops = useOpsShellOptional();

  const load = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading !== false;
    setErr(null);
    if (showLoading) setLoading(true);
    try {
      const data = await dashApi.getEnterpriseDashboard();
      setPayload(data);
    } catch (e) {
      setPayload(null);
      setErr(e instanceof Error ? e.message : "Failed to load enterprise dashboard");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const refreshSec = parseLiveRefreshIntervalSec(payload?.dashboard);

  useEffect(() => {
    void load({ showLoading: true });
  }, [load]);

  /** Reload when the shell context bar Refresh is used (same pattern as workflow / devices). */
  useEffect(() => {
    if (!ops || ops.refreshToken === 0) return;
    void load({ showLoading: false });
  }, [ops?.refreshToken, load, ops]);

  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => void load({ showLoading: false }), refreshSec * 1000);
    return () => window.clearInterval(t);
  }, [paused, load, refreshSec]);

  const dash = payload?.dashboard as Record<string, unknown> | undefined;
  const state = dash && typeof dash.state === "string" ? dash.state : null;
  /** No-primary payloads use `state` and omit `dashboard.id`; successful live bundles always include `id`. */
  const isNoPrimaryResponse =
    payload != null && !err && (state === "no_primary_dashboard" || typeof dash?.id !== "string");

  if (loading && !payload && !err) {
    return (
      <PageShell title="Primary Dashboard" className="dash-live-page">
        <PageStatus variant="info">Loading your primary dashboard…</PageStatus>
      </PageShell>
    );
  }

  if (isNoPrimaryResponse) {
    return (
      <PageShell title="Primary Dashboard">
        <PageStatus variant="info">
          <span>
            No primary dashboard is selected yet. Open{" "}
            <Link to="/dashboard/list" style={{ color: "var(--color-accent)" }}>
              Dashboards
            </Link>{" "}
            and choose <strong>Set primary</strong> on a frozen dashboard. The primary view is the default landing
            page for your team.
          </span>
        </PageStatus>
      </PageShell>
    );
  }

  const rawLayout = dash?.layout;
  const layout =
    rawLayout != null && typeof rawLayout === "object" ? (rawLayout as Record<string, unknown>) : {};

  return (
    <PageShell
      title="Primary Dashboard"
      className="dash-live-page"
      actions={
        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <Link to="/dashboard/list" className="dash-toolbar-link">
            All dashboards
          </Link>
          {payload?.primary_dashboard_id ? (
            <Link to={`/dashboard/${String(payload.primary_dashboard_id)}/live`} className="dash-toolbar-link">
              Open primary live
            </Link>
          ) : null}
        </span>
      }
    >
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      {payload && !err ? (
        <>
          <DashboardLiveToolbar
            captureRef={captureRef}
            fileBaseName="enterprise-dashboard"
            refreshIntervalSec={refreshSec}
            paused={paused}
            onTogglePause={() => setPaused((p) => !p)}
            onManualRefresh={() => void load({ showLoading: false })}
          />
          <div ref={captureRef} className="dash-live-capture-root">
            <DashboardLiveRenderer
              layout={layout}
              widgets={Array.isArray(payload.widgets) ? payload.widgets : []}
              renderedAt={payload.rendered_at}
              dashboard={payload.dashboard}
              enterpriseMode
            />
          </div>
        </>
      ) : null}
    </PageShell>
  );
}
