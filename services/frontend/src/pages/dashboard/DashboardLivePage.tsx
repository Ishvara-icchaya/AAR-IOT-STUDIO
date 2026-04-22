import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as dashApi from "@/api/dashboard";
import type { DashboardLiveDTO } from "@/types/dashboard";
import { DashboardLiveRenderer } from "@/components/dashboard/DashboardLiveRenderer";
import { DashboardLiveToolbar } from "@/components/dashboard/DashboardLiveToolbar";
import { parseLiveRefreshIntervalSec } from "@/lib/dashboardLiveSettings";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

export function DashboardLivePage() {
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const [payload, setPayload] = useState<DashboardLiveDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!dashboardId) return;
    setErr(null);
    try {
      const data = await dashApi.getDashboardLive(dashboardId);
      setPayload(data);
    } catch (e) {
      setPayload(null);
      setErr(e instanceof Error ? e.message : "Live load failed");
    }
  }, [dashboardId]);

  const refreshSec = parseLiveRefreshIntervalSec(payload?.dashboard);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (paused || !dashboardId) return;
    const t = window.setInterval(() => void load(), refreshSec * 1000);
    return () => window.clearInterval(t);
  }, [paused, load, refreshSec, dashboardId]);

  if (!dashboardId) return <PageShell>Missing id.</PageShell>;

  const layout = payload?.dashboard && typeof payload.dashboard === "object"
    ? (payload.dashboard as Record<string, unknown>).layout
    : undefined;

  return (
    <PageShell
      className="dash-live-page"
      variant="list"
      actions={<Link to={`/dashboard/${dashboardId}/edit`}>Edit layout</Link>}
    >
      {err ? (
        <PageStatus variant="error">
          <p style={{ margin: 0 }}>{err}</p>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
            Live mode requires a frozen dashboard. Unfreeze in the editor if you need to change layout.
          </p>
        </PageStatus>
      ) : null}
      {payload && layout != null ? (
        <>
          <DashboardLiveToolbar
            captureRef={captureRef}
            fileBaseName={`dashboard-${dashboardId}`}
            refreshIntervalSec={refreshSec}
            paused={paused}
            onTogglePause={() => setPaused((p) => !p)}
            onManualRefresh={() => void load()}
          />
          <div ref={captureRef} className="dash-live-capture-root">
            <DashboardLiveRenderer
              layout={layout}
              widgets={Array.isArray(payload.widgets) ? payload.widgets : []}
              renderedAt={payload.rendered_at}
              dashboard={payload.dashboard}
            />
          </div>
        </>
      ) : null}
    </PageShell>
  );
}
