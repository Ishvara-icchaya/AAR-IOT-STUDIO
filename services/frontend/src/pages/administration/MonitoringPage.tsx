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
import { MonitoringOverviewV2 } from "@/components/monitoring/MonitoringOverviewV2";
import { MonitoringQueueDetailDrawer } from "@/components/monitoring/MonitoringQueueDetailDrawer";
import { MonitoringQueueTable } from "@/components/monitoring/MonitoringQueueTable";
import { MonitoringResourcesTable } from "@/components/monitoring/MonitoringResourcesTable";
import { MonitoringServiceDetailDrawer } from "@/components/monitoring/MonitoringServiceDetailDrawer";
import { MonitoringServiceTable } from "@/components/monitoring/MonitoringServiceTable";
import { MonitoringStorageTable } from "@/components/monitoring/MonitoringStorageTable";
import { OpsDataTable } from "@/components/ops/OpsDataTable";
import { OpsPageHeader } from "@/components/ops/OpsPageHeader";
import { MonitoringTabs, type MonitoringTabId } from "@/components/monitoring/MonitoringTabs";
import { PageShell } from "@/layouts/PageShell";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";
import "@/pages/device-register-page.css";

const TAB_IDS: MonitoringTabId[] = [
  "overview",
  "services",
  "incidents",
  "queues",
  "resources",
  "storage",
  "ai",
];

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
  const [overviewFetchedAt, setOverviewFetchedAt] = useState<number | null>(null);

  useShellFeedback(err, null);

  const loadTab = useCallback(async (t: MonitoringTabId, options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    setErr(null);
    if (!silent) setLoading(true);
    try {
      const o = await fetchMonitoringOverview();
      setOverview(o ?? null);
      setOverviewFetchedAt(Date.now());

      if (t === "services") {
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
    const ms = tab === "overview" || tab === "incidents" ? 30_000 : 45_000;
    const id = window.setInterval(() => void loadTab(tab, { silent: true }), ms);
    return () => window.clearInterval(id);
  }, [tab, loadTab]);

  const showDataLoading = loading && isDataTab(tab);
  const showOverviewLoading = loading && (tab === "overview" || tab === "incidents") && !overview;
  const showAiLoading = loading && tab === "ai";

  return (
    <PageShell variant="list" className="device-manage-page monitoring-page--full monitoring-page--iot" style={{ width: "100%", maxWidth: "none", flex: 1, minHeight: 0 }}>
      <div className="dm-root">
        <OpsPageHeader
          title="Monitoring"
          subtitle="Platform health, services, queues, resources, storage, and AI usage."
        />

        <MonitoringTabs active={tab} onChange={setTab} />

        <div className="monitoring-page__tab-scroll">
          {tab === "overview" && (
            <div className="monitoring-page__overview-border">
              {showOverviewLoading ? (
                <OpsDataTable>
                  <div className="dm-device-table-shell">
                    <MonitoringLoadingBlock label="Loading overview…" />
                  </div>
                </OpsDataTable>
              ) : overview ? (
                <div className="monitoring-tab-panel">
                  <MonitoringOverviewV2 summary={overview.summary} lastFetchedAt={overviewFetchedAt} />
                </div>
              ) : null}
            </div>
          )}

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

          {tab === "incidents" &&
            (showOverviewLoading ? (
              <OpsDataTable>
                <div className="dm-device-table-shell">
                  <MonitoringLoadingBlock label="Loading incidents…" />
                </div>
              </OpsDataTable>
            ) : overview ? (
              <OpsDataTable>
                <div className="dm-device-table-shell">
                  <MonitoringIncidentTable items={overview.recent_incidents} />
                </div>
              </OpsDataTable>
            ) : null)}

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
