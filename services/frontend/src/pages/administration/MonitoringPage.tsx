import { useCallback, useEffect, useState } from "react";
import {
  fetchMonitoringAi,
  fetchMonitoringOverview,
  fetchMonitoringQueues,
  fetchMonitoringResources,
  fetchMonitoringServices,
  fetchMonitoringStorage,
  type MonitoringAiPayload,
  type MonitoringOverview,
  type MonitoringQueueRow,
  type MonitoringResourceRow,
  type MonitoringServiceRow,
  type MonitoringStorageRow,
} from "@/api/monitoring";
import { MonitoringAiTable } from "@/components/monitoring/MonitoringAiTable";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";
import { MonitoringHeader } from "@/components/monitoring/MonitoringHeader";
import { MonitoringIncidentTable } from "@/components/monitoring/MonitoringIncidentTable";
import { MonitoringMetricCard } from "@/components/monitoring/MonitoringMetricCard";
import { MonitoringOverviewGauges } from "@/components/monitoring/MonitoringOverviewGauges";
import { MonitoringOverviewCards } from "@/components/monitoring/MonitoringOverviewCards";
import { MonitoringQueueDetailDrawer } from "@/components/monitoring/MonitoringQueueDetailDrawer";
import { MonitoringQueueTable } from "@/components/monitoring/MonitoringQueueTable";
import { MonitoringResourcesTable } from "@/components/monitoring/MonitoringResourcesTable";
import { MonitoringServiceDetailDrawer } from "@/components/monitoring/MonitoringServiceDetailDrawer";
import { MonitoringServiceTable } from "@/components/monitoring/MonitoringServiceTable";
import { MonitoringStorageTable } from "@/components/monitoring/MonitoringStorageTable";
import type { MonitoringTabId } from "@/components/monitoring/MonitoringTabs";
import { MonitoringTabs } from "@/components/monitoring/MonitoringTabs";

const TAB_IDS: MonitoringTabId[] = ["overview", "services", "queues", "resources", "storage", "ai"];

function readQueryTab(): MonitoringTabId {
  if (typeof window === "undefined") return "overview";
  const t = new URLSearchParams(window.location.search).get("tab");
  return t && TAB_IDS.includes(t as MonitoringTabId) ? (t as MonitoringTabId) : "overview";
}

function readQueryService(): string | null {
  if (typeof window === "undefined") return null;
  const s = new URLSearchParams(window.location.search).get("service");
  return s && s.trim() ? s.trim() : null;
}

export function MonitoringPage() {
  const [tab, setTab] = useState<MonitoringTabId>(readQueryTab);
  /** Start true when deep-linking to a service so we do not drop `service` before the first fetch. */
  const [loading, setLoading] = useState(() => readQueryService() !== null);
  const [err, setErr] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [pendingServiceDrawer, setPendingServiceDrawer] = useState<string | null>(readQueryService);

  const [overview, setOverview] = useState<MonitoringOverview | null>(null);
  const [services, setServices] = useState<MonitoringServiceRow[]>([]);
  const [queues, setQueues] = useState<MonitoringQueueRow[]>([]);
  const [resources, setResources] = useState<MonitoringResourceRow[]>([]);
  const [storage, setStorage] = useState<MonitoringStorageRow[]>([]);
  const [ai, setAi] = useState<MonitoringAiPayload | null>(null);
  const [drawerService, setDrawerService] = useState<string | null>(null);
  const [drawerQueue, setDrawerQueue] = useState<MonitoringQueueRow | null>(null);

  const loadTab = useCallback(async (t: MonitoringTabId) => {
    setErr(null);
    setLoading(true);
    try {
      if (t === "overview") {
        const o = await fetchMonitoringOverview();
        setOverview(o ?? null);
      } else if (t === "services") {
        const s = await fetchMonitoringServices();
        setServices(s ?? []);
      } else if (t === "queues") {
        const q = await fetchMonitoringQueues();
        setQueues(q ?? []);
      } else if (t === "resources") {
        const r = await fetchMonitoringResources();
        setResources(r ?? []);
      } else if (t === "storage") {
        const st = await fetchMonitoringStorage();
        setStorage(st ?? []);
      } else if (t === "ai") {
        const a = await fetchMonitoringAi();
        setAi(a ?? null);
      }
      setLastUpdated(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTab(tab);
  }, [tab, loadTab]);

  useEffect(() => {
    if (tab !== "services" || pendingServiceDrawer === null) return;
    if (loading) return;
    const want = pendingServiceDrawer;
    if (services.some((r) => r.service_name === want)) {
      setDrawerService(want);
    }
    setPendingServiceDrawer(null);
  }, [tab, pendingServiceDrawer, services, loading]);

  useEffect(() => {
    const ms = tab === "overview" ? 30_000 : 45_000;
    const id = window.setInterval(() => void loadTab(tab), ms);
    return () => window.clearInterval(id);
  }, [tab, loadTab]);

  async function refreshAll() {
    await loadTab(tab);
  }

  return (
    <PageShell
      title="Monitoring"
      className="monitoring-page--full"
      style={{ width: "100%", maxWidth: "none", flex: 1, minHeight: 0 }}
      actions={<MonitoringHeader onRefresh={refreshAll} loading={loading} lastUpdated={lastUpdated} />}
    >
      <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        Operational view of stack health, queues, and workers. Alerts integrate with the unified alerts list.
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}

      <MonitoringTabs active={tab} onChange={setTab} />

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", paddingRight: "2px" }}>
      {tab === "overview" && overview && (
        <div>
          <MonitoringOverviewCards summary={overview.summary} />
          <MonitoringOverviewGauges summary={overview.summary} />
          <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Resource summary</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.25rem" }}>
            <MonitoringMetricCard
              title="CPU (API process)"
              status={overview.summary.cpu_percent != null ? "healthy" : "unknown"}
              subtitle={overview.summary.cpu_percent != null ? `${overview.summary.cpu_percent}%` : "n/a"}
            />
            <MonitoringMetricCard
              title="Memory (host %)"
              status={overview.summary.memory_percent != null ? "healthy" : "unknown"}
              subtitle={
                overview.summary.memory_percent != null ? `${overview.summary.memory_percent}%` : "n/a (host psutil)"
              }
            />
            <MonitoringMetricCard
              title="Active alerts"
              status={overview.summary.active_alerts > 0 ? "warning" : "healthy"}
              subtitle={`${overview.summary.active_alerts} open`}
            />
            <MonitoringMetricCard
              title="Queue lag"
              status={overview.summary.queue_status ?? "unknown"}
              subtitle={
                overview.summary.queue_lag_messages != null
                  ? `${overview.summary.queue_lag_messages} msgs (sum)`
                  : "n/a"
              }
            />
            <MonitoringMetricCard
              title="WebSockets"
              status="unknown"
              subtitle={overview.summary.websocket_connections != null ? String(overview.summary.websocket_connections) : "n/a Phase 1"}
            />
          </div>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Recent incidents</h2>
          <MonitoringIncidentTable items={overview.recent_incidents} />
        </div>
      )}

      {tab === "services" && <MonitoringServiceTable rows={services} onView={(n) => setDrawerService(n)} />}
      {tab === "queues" && <MonitoringQueueTable rows={queues} onView={(r) => setDrawerQueue(r)} />}
      {tab === "resources" && <MonitoringResourcesTable rows={resources} />}
      {tab === "storage" && <MonitoringStorageTable rows={storage} />}
      {tab === "ai" &&
        (ai ? (
          <MonitoringAiTable data={ai} />
        ) : (
          <p style={{ color: "var(--color-text-muted)" }}>{loading ? "Loading…" : "No data"}</p>
        ))}
      </div>

      <MonitoringServiceDetailDrawer serviceName={drawerService} onClose={() => setDrawerService(null)} />
      <MonitoringQueueDetailDrawer row={drawerQueue} onClose={() => setDrawerQueue(null)} />
    </PageShell>
  );
}
