import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as dashApi from "@/api/dashboard";
import type { DashboardLiveDTO } from "@/types/dashboard";
import { DashboardLiveRenderer } from "@/components/dashboard/DashboardLiveRenderer";
import { DashboardLiveToolbar } from "@/components/dashboard/DashboardLiveToolbar";
import { parseLiveRefreshIntervalSec } from "@/lib/dashboardLiveSettings";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

export function EnterpriseDashboardPage() {
  const [payload, setPayload] = useState<DashboardLiveDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await dashApi.getEnterpriseDashboard();
      setPayload(data);
    } catch (e) {
      setPayload(null);
      setErr(e instanceof Error ? e.message : "Failed to load enterprise dashboard");
    }
  }, []);

  const refreshSec = parseLiveRefreshIntervalSec(payload?.dashboard);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => void load(), refreshSec * 1000);
    return () => window.clearInterval(t);
  }, [paused, load, refreshSec]);

  const dash = payload?.dashboard as Record<string, unknown> | undefined;
  const state = dash && typeof dash.state === "string" ? dash.state : null;

  if (state === "no_primary_dashboard") {
    return (
      <PageShell title="Enterprise Dashboard">
        <p style={{ color: "var(--color-text-muted)" }}>
          No primary dashboard is set. Open{" "}
          <Link to="/dashboard/list" style={{ color: "var(--color-accent)" }}>
            Dashboards
          </Link>{" "}
          and choose <strong>Set primary</strong> on a frozen dashboard.
        </p>
      </PageShell>
    );
  }

  const layout = dash?.layout;

  return (
    <PageShell title="Enterprise Dashboard" className="dash-live-page">
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      {payload && layout != null ? (
        <>
          <DashboardLiveToolbar
            captureRef={captureRef}
            fileBaseName="enterprise-dashboard"
            refreshIntervalSec={refreshSec}
            paused={paused}
            onTogglePause={() => setPaused((p) => !p)}
            onManualRefresh={() => void load()}
          />
          <div ref={captureRef} className="dash-live-capture-root">
            <DashboardLiveRenderer
              layout={layout}
              widgets={payload.widgets}
              renderedAt={payload.rendered_at}
              dashboard={payload.dashboard}
            />
          </div>
        </>
      ) : null}
    </PageShell>
  );
}
