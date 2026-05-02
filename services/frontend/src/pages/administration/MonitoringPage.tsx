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
import { MonitoringIncidentTable } from "@/components/monitoring/MonitoringIncidentTable";
import { MonitoringLoadingBlock } from "@/components/monitoring/MonitoringLoadingBlock";
import { MonitoringMetricCard } from "@/components/monitoring/MonitoringMetricCard";
import { MonitoringOverviewGauges } from "@/components/monitoring/MonitoringOverviewGauges";
import { MonitoringOverviewCards } from "@/components/monitoring/MonitoringOverviewCards";
import { MonitoringQueueDetailDrawer } from "@/components/monitoring/MonitoringQueueDetailDrawer";
import { MonitoringQueueTable } from "@/components/monitoring/MonitoringQueueTable";
import { MonitoringResourcesTable } from "@/components/monitoring/MonitoringResourcesTable";
import { MonitoringServiceDetailDrawer } from "@/components/monitoring/MonitoringServiceDetailDrawer";
import { MonitoringServiceTable } from "@/components/monitoring/MonitoringServiceTable";
import { MonitoringStorageTable } from "@/components/monitoring/MonitoringStorageTable";
import { MonitoringAlertsStrip } from "@/components/ops/MonitoringAlertsStrip";
import { OpsDataTable } from "@/components/ops/OpsDataTable";
import { OpsPageHeader } from "@/components/ops/OpsPageHeader";
import { MonitoringTabs, type MonitoringTabId } from "@/components/monitoring/MonitoringTabs";
import { PageShell } from "@/layouts/PageShell";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";
import "@/pages/device-register-page.css";

const TAB_IDS: MonitoringTabId[] = ["overview", "services", "queues", "resources", "storage", "ai"];

const DATA_TABS: MonitoringTabId[] = ["services", "queues", "resources", "storage"];

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

function isDataTab(t: MonitoringTabId): boolean {
  return DATA_TABS.includes(t);
}

export function MonitoringPage() {
  const [tab, setTab] = useState<MonitoringTabId>(readQueryTab);
  const [loading, setLoading] = useState(() => readQueryService() !== null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingServiceDrawer, setPendingServiceDrawer] = useState<string | null>(readQueryService);

  const [overview, setOverview] = useState<MonitoringOverview | null>(null);
  const [services, setServices] = useState<MonitoringServiceRow[]>([]);
  const [queues, setQueues] = useState<MonitoringQueueRow[]>([]);
  const [resources, setResources] = useState<MonitoringResourceRow[]>([]);
  const [storage, setStorage] = useState<MonitoringStorageRow[]>([]);
  const [ai, setAi] = useState<MonitoringAiPayload | null>(null);
  const [drawerService, setDrawerService] = useState<string | null>(null);
  const [drawerQueue, setDrawerQueue] = useState<MonitoringQueueRow | null>(null);

  useShellFeedback(err, null);

  const loadTab = useCallback(async (t: MonitoringTabId, options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    setErr(null);
    if (!silent) setLoading(true);
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      if (!silent) setLoading(false);
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
    const id = window.setInterval(() => void loadTab(tab, { silent: true }), ms);
    return () => window.clearInterval(id);
  }, [tab, loadTab]);

  const showDataLoading = loading && isDataTab(tab);
  const showOverviewLoading = loading && tab === "overview" && !overview;
  const showAiLoading = loading && tab === "ai";

  return (
    <PageShell variant="list" className="device-manage-page monitoring-page--full monitoring-page--iot" style={{ width: "100%", maxWidth: "none", flex: 1, minHeight: 0 }}>
      <div className="dm-root">
        <OpsPageHeader
          title="Monitoring"
          subtitle="Platform health, services, queues, resources, storage, and AI usage — same layout as Manage Devices."
        />

        <MonitoringAlertsStrip />
        <MonitoringTabs active={tab} onChange={setTab} />

        <div className="monitoring-page__tab-scroll">
          {tab === "overview" &&
            (showOverviewLoading ? (
              <OpsDataTable>
                <div className="dm-device-table-shell">
                  <MonitoringLoadingBlock label="Loading overview…" />
                </div>
              </OpsDataTable>
            ) : overview ? (
              <div className="monitoring-tab-panel">
                <MonitoringOverviewCards summary={overview.summary} />
                <MonitoringOverviewGauges summary={overview.summary} />
                <div className="monitoring-tab-panel__subhead">Resource summary</div>
                <div className="monitoring-metric-row">
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
                    subtitle={
                      overview.summary.websocket_connections != null
                        ? String(overview.summary.websocket_connections)
                        : "n/a Phase 1"
                    }
                  />
                </div>
                <div className="monitoring-tab-panel__subhead">Recent incidents</div>
                <OpsDataTable>
                  <div className="dm-device-table-shell">
                    <MonitoringIncidentTable items={overview.recent_incidents} />
                  </div>
                </OpsDataTable>
              </div>
            ) : null)}

          {tab === "services" && (
            <OpsDataTable>
              <div className="dm-device-table-shell">
                {showDataLoading ? (
                  <MonitoringLoadingBlock label="Loading services…" />
                ) : (
                  <MonitoringServiceTable rows={services} onView={(n) => setDrawerService(n)} />
                )}
              </div>
            </OpsDataTable>
          )}

          {tab === "queues" && (
            <OpsDataTable>
              <div className="dm-device-table-shell">
                {showDataLoading ? (
                  <MonitoringLoadingBlock label="Loading queues…" />
                ) : (
                  <MonitoringQueueTable rows={queues} onView={(r) => setDrawerQueue(r)} />
                )}
              </div>
            </OpsDataTable>
          )}

          {tab === "resources" && (
            <OpsDataTable>
              <div className="dm-device-table-shell">
                {showDataLoading ? (
                  <MonitoringLoadingBlock label="Loading resources…" />
                ) : (
                  <MonitoringResourcesTable rows={resources} />
                )}
              </div>
            </OpsDataTable>
          )}

          {tab === "storage" && (
            <OpsDataTable>
              <div className="dm-device-table-shell">
                {showDataLoading ? (
                  <MonitoringLoadingBlock label="Loading storage…" />
                ) : (
                  <MonitoringStorageTable rows={storage} />
                )}
              </div>
            </OpsDataTable>
          )}

          {tab === "ai" &&
            (showAiLoading ? (
              <OpsDataTable>
                <div className="dm-device-table-shell">
                  <MonitoringLoadingBlock label="Loading AI metrics…" />
                </div>
              </OpsDataTable>
            ) : ai ? (
              <OpsDataTable>
                <div className="dm-device-table-shell">
                  <MonitoringAiTable data={ai} />
                </div>
              </OpsDataTable>
            ) : (
              <OpsDataTable>
                <div className="dm-device-table-shell">
                  <p className="dm-empty" style={{ margin: "1rem 0.75rem" }}>
                    No AI / LLM usage data returned for this environment.
                  </p>
                </div>
              </OpsDataTable>
            ))}
        </div>
      </div>

      <MonitoringServiceDetailDrawer serviceName={drawerService} onClose={() => setDrawerService(null)} />
      <MonitoringQueueDetailDrawer row={drawerQueue} onClose={() => setDrawerQueue(null)} />
    </PageShell>
  );
}
