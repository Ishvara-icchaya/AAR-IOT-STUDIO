import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ChevronRight, FileText, Footprints, Search } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { apiFetch, isApiHttpError } from "@/api/client";
import {
  deviceRegisterVersionHistoryUrl,
  getDevice,
  getDeviceFootprint,
  getDeviceVersionLineage,
  listDevices,
  type DeviceFootprintRead,
  type DeviceRead,
  type DeviceVersionLineageRead,
} from "@/api/devices";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { AppModalShell } from "@/components/app/AppModalShell";
import { OpsActionButton } from "@/components/ops/OpsActionButton";
import { OpsDataTable } from "@/components/ops/OpsDataTable";
import { OpsFilterPanel } from "@/components/ops/OpsFilterPanel";
import { OpsKpiRow } from "@/components/ops/OpsKpiRow";
import { OpsPageHeader } from "@/components/ops/OpsPageHeader";
import { OpsScopeControls } from "@/components/ops/OpsScopeControls";
import { OpsStatusPill, type OpsVariant } from "@/components/ops/OpsStatusPill";
import { LineageSummarizeModal } from "@/components/lineage/LineageSummarizeModal";
import { DeviceVersionHistoryDrawer } from "@/components/device/DeviceVersionHistoryDrawer";
import { PageShell } from "@/layouts/PageShell";
import { userIsAdmin } from "@/layouts/shell/navigation";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";
import { normalizeProtocol } from "@/lib/deviceEndpointConfig";
import {
  footprintOperationalPillVariant,
  formatFootprintOperationalStatus,
} from "@/lib/deviceOperationalFootprintUi";
import { formatStatusDisplayLabel } from "@/lib/statusDisplay";
import { AppIcon, ICON_SIZES, ICON_STROKE_WIDTH, type AppIconName } from "@/lib/appIcons";
import type { DeviceFootprintPdfInput } from "@/lib/lineageSummaryPdf";

import "./device-register-page.css";

type SiteRow = { id: string; name: string };

function footprintRecommendationPillVariant(code: string | null | undefined): OpsVariant {
  const c = (code || "").trim().toUpperCase();
  if (!c) return "muted";
  if (c === "HEALTHY") return "online";
  if (c === "PIPELINE_ERROR") return "offline";
  return "muted";
}

function footprintBucket(d: DeviceRead): string {
  const s = d.footprint_operational_status?.trim();
  if (!s) return "unset";
  return s;
}

function protocolLabel(d: DeviceRead): string {
  const p = d.endpoint?.protocol;
  if (!p || !String(p).trim()) return "—";
  return normalizeProtocol(String(p)).toUpperCase();
}

type PipelineStageState = "complete" | "pending" | "error";

function stageIngest(fp: DeviceFootprintRead): PipelineStageState {
  if (!fp.ingestion.last_ingested_at) return "pending";
  const age = fp.ingestion.ingest_age_sec;
  const stale = fp.ingestion.stale_after_sec;
  if (age != null && stale != null && age > stale) return "error";
  return "complete";
}

function stageEndpoint(fp: DeviceFootprintRead): PipelineStageState {
  if (!fp.endpoint) return "pending";
  const s = (fp.endpoint.status || "").toLowerCase();
  if (s === "error") return "error";
  if (s === "active") return "complete";
  return "pending";
}

function stageScrubber(fp: DeviceFootprintRead): PipelineStageState {
  if (!fp.scrubber.associated) return "pending";
  const st = (fp.scrubber.status || "").toLowerCase();
  if (st.includes("error") || st.includes("fail")) return "error";
  return "complete";
}

function stageWorkflow(fp: DeviceFootprintRead): PipelineStageState {
  if (!fp.workflow.associated) return "pending";
  const w = fp.workflow.workflows;
  if (Array.isArray(w) && w.length > 0) return "complete";
  return "pending";
}

function stageDashboard(fp: DeviceFootprintRead): PipelineStageState {
  if (fp.dashboard.count > 0) return "complete";
  return "pending";
}

/** Advanced footprint row status keys (labels via ``OpsStatusPill`` + ``formatStatusDisplayLabel``). */
type AdvancedDetailStatus = "no_data" | "not_set" | "completed" | "stale" | "error" | "partial";

type AdvancedStageKey = "ingestion" | "scrubber" | "workflow" | "dashboard" | "trends";

const ADVANCED_STAGE_ROWS: { key: AdvancedStageKey; label: string }[] = [
  { key: "ingestion", label: "Ingestion" },
  { key: "scrubber", label: "Scrubber" },
  { key: "workflow", label: "Workflow" },
  { key: "dashboard", label: "Dashboard" },
  { key: "trends", label: "Trends" },
];

type FootprintDetailTab = "version_kpi" | "advanced";

function versionTriggerLabel(code: string): string {
  switch (code) {
    case "bootstrap":
      return "Bootstrap (current row)";
    case "explicit":
      return "Explicit";
    case "ota":
      return "OTA";
    case "ingest_shape":
      return "Ingest shape";
    default:
      return code || "—";
  }
}

function FootprintVersionTimeline({ lineage }: { lineage: DeviceVersionLineageRead | null }) {
  const rows = lineage?.versions?.length ? lineage.versions : [];
  if (!rows.length) {
    return <p className="device-lineage-version-timeline__empty dash-widget__muted">No version rows returned.</p>;
  }
  return (
    <div className="device-lineage-version-timeline">
      <h4 className="device-lineage-version-timeline__title">Version timeline</h4>
      <ul className="device-lineage-version-timeline__list">
        {rows.map((v) => (
          <li key={v.id} className="device-lineage-version-timeline__item">
            <span className="device-lineage-version-timeline__dot" aria-hidden />
            <div>
              <div className="device-lineage-version-timeline__label">
                v{v.version_label}
                {v.is_current ? " · current" : ""}
              </div>
              <p className="device-lineage-version-timeline__note">
                {versionTriggerLabel(v.trigger_code)}
                {v.recorded_at ? ` · ${new Date(v.recorded_at).toLocaleString()}` : ""}
                {v.superseded_by_label ? ` · superseded by v${v.superseded_by_label}` : ""}
                {v.ota_external_ref ? ` · OTA ref: ${v.ota_external_ref}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function advancedDetailStatus(fp: DeviceFootprintRead, stage: AdvancedStageKey): AdvancedDetailStatus {
  switch (stage) {
    case "ingestion": {
      if (!fp.ingestion.last_ingested_at) return "no_data";
      const age = fp.ingestion.ingest_age_sec;
      const stale = fp.ingestion.stale_after_sec;
      if (age != null && stale != null && age > stale) return "stale";
      return "completed";
    }
    case "scrubber": {
      if (!fp.scrubber.associated) return "not_set";
      const st = (fp.scrubber.status || "").toLowerCase();
      if (st.includes("error") || st.includes("fail")) return "error";
      return "completed";
    }
    case "workflow": {
      if (!fp.workflow.associated) return "not_set";
      const w = fp.workflow.workflows;
      if (Array.isArray(w) && w.length > 0) return "completed";
      return "partial";
    }
    case "dashboard": {
      if (fp.dashboard.count <= 0) return "no_data";
      return "completed";
    }
    case "trends": {
      const t = fp.trends;
      const rollup = Boolean(t.device_trend_available || t.endpoint_rollup_available);
      const hasRecords = t.records_1h != null || t.records_24h != null;
      if (rollup) return "completed";
      if (hasRecords) return "partial";
      return "no_data";
    }
    default:
      return "not_set";
  }
}

function advancedPayload(fp: DeviceFootprintRead, stage: AdvancedStageKey): unknown {
  switch (stage) {
    case "ingestion":
      return fp.ingestion;
    case "scrubber":
      return fp.scrubber;
    case "workflow":
      return fp.workflow;
    case "dashboard":
      return fp.dashboard;
    case "trends":
      return fp.trends;
    default:
      return null;
  }
}

function advancedDetailPillVariant(s: AdvancedDetailStatus): OpsVariant {
  switch (s) {
    case "completed":
      return "online";
    case "stale":
    case "partial":
      return "muted";
    case "error":
      return "offline";
    case "no_data":
    case "not_set":
    default:
      return "muted";
  }
}

function PipelineStageCard({
  label,
  state,
  value,
  sub,
}: {
  label: string;
  state: PipelineStageState;
  value: string;
  sub?: ReactNode;
}) {
  const deco = state === "complete" ? "online" : state === "error" ? "error" : "muted";
  const decoIcon: AppIconName = state === "complete" ? "online" : state === "error" ? "offline" : "degraded";
  return (
    <div
      className={`dm-kpi dm-kpi--with-deco device-lineage-pipeline__stage device-lineage-pipeline__stage--${state}`}
    >
      <div className="dm-kpi__body">
        <div className="dm-kpi__label">{label}</div>
        <div className="dm-kpi__value device-lineage-pipeline__value">{value}</div>
        {sub ? <div className="dm-kpi__sub">{sub}</div> : null}
      </div>
      <div className={`dm-kpi__deco dm-kpi__deco--${deco}`} aria-hidden>
        <AppIcon name={decoIcon} size="card" aria-hidden />
      </div>
    </div>
  );
}

const KPI_COMPARE_NONE = "__none__";

const KPI_ROW_LABELS: Record<string, string> = {
  footprint_status: "Footprint status",
  "ingestion.last_ingested_at": "Last ingested at",
  "ingestion.ingest_age_sec": "Ingest age (sec)",
  "dashboard.count": "Dashboard count",
  "endpoint.status": "Endpoint status",
  "scrubber.associated": "Scrubber linked",
  "scrubber.status": "Scrubber status",
};

function formatKpiCompareCell(key: string, val: unknown): string {
  if (val === null || val === undefined) return "Not present";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  if (typeof val === "string") {
    const t = val.trim();
    if (!t && key.includes("ingested")) return "Not present";
    if (!t) return "Not present";
    return val;
  }
  return String(val);
}

function VersionKpiCompareSection({
  lineage,
  initialCompareA,
  initialCompareB,
  onCompareChange,
}: {
  lineage: DeviceVersionLineageRead | null;
  /** Query `compareA`: version label or `none` for empty baseline. */
  initialCompareA?: string | null;
  /** Query `compareB`: version label (defaults to newest when omitted). */
  initialCompareB?: string | null;
  /** Called when the user changes A/B so the shareable URL can stay in sync. */
  onCompareChange?: (compareA: string, compareB: string) => void;
}) {
  const keys = lineage?.kpi_metric_keys ?? [];
  const versionLabels = useMemo(() => lineage?.versions?.map((v) => v.version_label) ?? [], [lineage]);
  const [left, setLeft] = useState(KPI_COMPARE_NONE);
  const [right, setRight] = useState("");

  useEffect(() => {
    const labels = versionLabels;
    const newest = labels.length ? labels[labels.length - 1]! : "";
    const second = labels.length > 1 ? labels[labels.length - 2]! : KPI_COMPARE_NONE;
    const hasUrl =
      (initialCompareA != null && String(initialCompareA).trim() !== "") ||
      (initialCompareB != null && String(initialCompareB).trim() !== "");
    if (hasUrl) {
      const rawA = initialCompareA?.trim() ?? "";
      if (rawA === "none" || rawA === KPI_COMPARE_NONE) setLeft(KPI_COMPARE_NONE);
      else if (rawA && labels.includes(rawA)) setLeft(rawA);
      else setLeft(second === KPI_COMPARE_NONE ? KPI_COMPARE_NONE : second);
      const rawB = initialCompareB?.trim() ?? "";
      if (rawB && labels.includes(rawB)) setRight(rawB);
      else setRight(newest);
    } else {
      setRight(newest);
      setLeft(second === KPI_COMPARE_NONE ? KPI_COMPARE_NONE : second);
    }
  }, [lineage?.device_id, versionLabels.join("|"), initialCompareA, initialCompareB]);

  const leftMap = left === KPI_COMPARE_NONE ? null : lineage?.kpi_by_version[left];
  const rightMap = right ? lineage?.kpi_by_version[right] ?? null : null;

  if (!keys.length) {
    return (
      <p className="device-lineage-kpi-compare__empty dash-widget__muted">
        No KPI snapshot is available for this device yet.
      </p>
    );
  }

  return (
    <section className="device-lineage-kpi-compare" aria-labelledby="device-lineage-kpi-heading">
      <h3 id="device-lineage-kpi-heading" className="device-lineage-footprint-detail__block-title">
        KPI compare (footprint-derived)
      </h3>
      <p className="device-lineage-kpi-compare__hint dash-widget__muted">
        Missing values on either side are shown as not present (per device versioning spec).
      </p>
      <div className="device-lineage-kpi-compare__selectors">
        <label className="device-lineage-kpi-compare__field">
          <span>Version A</span>
          <select
            className="dm-filter-field select"
            value={left}
            onChange={(e) => {
              const v = e.target.value;
              setLeft(v);
              onCompareChange?.(v === KPI_COMPARE_NONE ? "none" : v, right);
            }}
          >
            <option value={KPI_COMPARE_NONE}>Not present (empty baseline)</option>
            {versionLabels.map((l) => (
              <option key={l} value={l}>
                v{l}
              </option>
            ))}
          </select>
        </label>
        <label className="device-lineage-kpi-compare__field">
          <span>Version B</span>
          <select
            className="dm-filter-field select"
            value={right}
            onChange={(e) => {
              const v = e.target.value;
              setRight(v);
              onCompareChange?.(left === KPI_COMPARE_NONE ? "none" : left, v);
            }}
          >
            {versionLabels.map((l) => (
              <option key={`b-${l}`} value={l}>
                v{l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="device-lineage-kpi-compare__table-wrap">
        <table className="device-lineage-kpi-compare__table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">A</th>
              <th scope="col">B</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <th scope="row">{KPI_ROW_LABELS[k] ?? k}</th>
                <td>{formatKpiCompareCell(k, leftMap?.[k])}</td>
                <td>{formatKpiCompareCell(k, rightMap?.[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FootprintDetailSections({
  fp,
  deviceRow,
  siteName,
  lineage,
  versionHistoryRegisterUrl,
  onSummarize,
  initialCompareA,
  initialCompareB,
  onKpiCompareUrlSync,
}: {
  fp: DeviceFootprintRead;
  deviceRow: DeviceRead | null;
  /** Resolved tenant site label; never show raw site UUID in the snapshot. */
  siteName: string | null;
  lineage: DeviceVersionLineageRead | null;
  /** Link to device register with version history drawer (deep link). */
  versionHistoryRegisterUrl: string | null;
  /** Open PDF / Send-to modal for this device’s footprint. */
  onSummarize: () => void;
  initialCompareA?: string | null;
  initialCompareB?: string | null;
  onKpiCompareUrlSync?: (compareA: string, compareB: string) => void;
}) {
  const [detailTab, setDetailTab] = useState<FootprintDetailTab>("version_kpi");
  const [advancedStage, setAdvancedStage] = useState<AdvancedStageKey>("ingestion");

  useEffect(() => {
    setAdvancedStage("ingestion");
    setDetailTab("version_kpi");
  }, [fp.device.device_id]);

  const si = stageIngest(fp);
  const se = stageEndpoint(fp);
  const ss = stageScrubber(fp);
  const sw = stageWorkflow(fp);
  const sd = stageDashboard(fp);

  const ingestValue = fp.ingestion.last_ingested_at ? "Receiving" : "No data";
  const endpointValue = fp.endpoint ? (fp.endpoint.status || "—") : "—";
  const scrubberValue = fp.scrubber.associated ? "Linked" : "Not set";
  const workflowValue = fp.workflow.associated ? "Linked" : "Not set";
  const dashboardValue = fp.dashboard.count > 0 ? String(fp.dashboard.count) : "0";

  const ver = deviceRow?.device_version?.trim();
  const versionSub =
    ver && ver.length > 0 ? (
      <span className="device-lineage-pipeline__version device-lineage-pipeline__version--set">v{ver}</span>
    ) : (
      <span className="device-lineage-pipeline__version">No version</span>
    );

  return (
    <div className="device-lineage-footprint-detail">
      <div className="device-lineage-footprint-summary">
        <div className="device-lineage-footprint-summary__col">
          <h3 className="device-lineage-footprint-detail__block-title">Summary</h3>
          <dl className="device-lineage-footprint-summary__dl">
            <dt>Operational status</dt>
            <dd>{formatFootprintOperationalStatus(fp.status)}</dd>
            <dt>Recommendation</dt>
            <dd>
              <strong>
                {fp.recommendation.code?.trim()
                  ? formatStatusDisplayLabel(fp.recommendation.code.trim().toLowerCase())
                  : "—"}
              </strong>
              <div className="device-lineage-footprint-summary__msg">{fp.recommendation.message}</div>
            </dd>
          </dl>
        </div>
        <div className="device-lineage-footprint-summary__col">
          <h3 className="device-lineage-footprint-detail__block-title">Device snapshot</h3>
          <dl className="device-lineage-footprint-summary__dl">
            <dt>Name</dt>
            <dd>{deviceRow?.name ?? "—"}</dd>
            <dt>Device ID</dt>
            <dd>
              <code className="device-lineage-footprint-summary__code">{fp.device.device_id}</code>
            </dd>
            <dt>Site name</dt>
            <dd>{siteName?.trim() ? siteName.trim() : "—"}</dd>
            <dt>Resolved device</dt>
            <dd>{fp.device.resolved_device_id ?? "—"}</dd>
            <dt>Activation</dt>
            <dd>{fp.device.activation_status ?? "—"}</dd>
            {deviceRow?.version_status ? (
              <>
                <dt>Version status</dt>
                <dd>{deviceRow.version_status}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </div>

      <div className="device-lineage-pipeline" aria-label="Operational pipeline">
        <PipelineStageCard label="Ingest" state={si} value={ingestValue} sub={versionSub} />
        <span className="device-lineage-pipeline__arrow" aria-hidden>
          <ChevronRight size={20} strokeWidth={2} />
        </span>
        <PipelineStageCard label="Endpoint" state={se} value={endpointValue} />
        <span className="device-lineage-pipeline__arrow" aria-hidden>
          <ChevronRight size={20} strokeWidth={2} />
        </span>
        <PipelineStageCard label="Scrubber" state={ss} value={scrubberValue} />
        <span className="device-lineage-pipeline__arrow" aria-hidden>
          <ChevronRight size={20} strokeWidth={2} />
        </span>
        <PipelineStageCard label="Workflow" state={sw} value={workflowValue} />
        <span className="device-lineage-pipeline__arrow" aria-hidden>
          <ChevronRight size={20} strokeWidth={2} />
        </span>
        <PipelineStageCard label="Dashboard" state={sd} value={dashboardValue} />
      </div>

      <div className="device-lineage-footprint-actions">
        <button
          type="button"
          className="dm-btn dm-btn--outline dm-btn--compact"
          style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
          onClick={onSummarize}
        >
          <FileText size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
          Summarize
        </button>
        {versionHistoryRegisterUrl ? (
          <Link className="dm-btn dm-btn--outline dm-btn--compact" to={versionHistoryRegisterUrl}>
            Version history (register)
          </Link>
        ) : null}
      </div>

      <div className="device-lineage-detail-tabs" role="region" aria-label="Footprint detail tabs">
        <div className="device-lineage-detail-tabs__bar" role="tablist" aria-label="Footprint sections">
          <button
            type="button"
            role="tab"
            aria-selected={detailTab === "version_kpi"}
            id="footprint-tab-version"
            className={`device-lineage-detail-tabs__tab${detailTab === "version_kpi" ? " device-lineage-detail-tabs__tab--active" : ""}`}
            onClick={() => setDetailTab("version_kpi")}
          >
            Version history & KPI
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={detailTab === "advanced"}
            id="footprint-tab-advanced"
            className={`device-lineage-detail-tabs__tab${detailTab === "advanced" ? " device-lineage-detail-tabs__tab--active" : ""}`}
            onClick={() => setDetailTab("advanced")}
          >
            Advanced details
          </button>
        </div>

        <div
          role="tabpanel"
          aria-labelledby="footprint-tab-version"
          hidden={detailTab !== "version_kpi"}
          className="device-lineage-detail-tabs__panel"
        >
          <FootprintVersionTimeline lineage={lineage} />
          <VersionKpiCompareSection
            lineage={lineage}
            initialCompareA={initialCompareA}
            initialCompareB={initialCompareB}
            onCompareChange={onKpiCompareUrlSync}
          />
        </div>

        <div
          role="tabpanel"
          aria-labelledby="footprint-tab-advanced"
          hidden={detailTab !== "advanced"}
          className="device-lineage-detail-tabs__panel device-lineage-detail-tabs__panel--advanced"
        >
          <div className="device-lineage-advanced device-lineage-advanced--tabbed">
            <div className="device-lineage-advanced__body">
              <nav className="device-lineage-advanced__nav" aria-label="Select footprint stage for raw JSON">
                <ul className="device-lineage-advanced__list">
                  {ADVANCED_STAGE_ROWS.map(({ key, label }) => {
                    const st = advancedDetailStatus(fp, key);
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          className={`device-lineage-advanced__stage-btn${advancedStage === key ? " device-lineage-advanced__stage-btn--active" : ""}`}
                          onClick={() => setAdvancedStage(key)}
                        >
                          <span className="device-lineage-advanced__stage-name">{label}</span>
                          <OpsStatusPill status={st} variant={advancedDetailPillVariant(st)} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              <div className="device-lineage-advanced__panel">
                <div className="device-lineage-advanced__panel-head">
                  <span className="device-lineage-advanced__panel-title">
                    {ADVANCED_STAGE_ROWS.find((r) => r.key === advancedStage)?.label ?? advancedStage}
                  </span>
                  <OpsStatusPill
                    status={advancedDetailStatus(fp, advancedStage)}
                    variant={advancedDetailPillVariant(advancedDetailStatus(fp, advancedStage))}
                  />
                </div>
                <AdvancedJsonPanel fp={fp} stage={advancedStage} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdvancedJsonPanel({ fp, stage }: { fp: DeviceFootprintRead; stage: AdvancedStageKey }) {
  const payload = advancedPayload(fp, stage);
  if (payload === null || payload === undefined) {
    return <p className="device-lineage-advanced__placeholder">{formatStatusDisplayLabel("no_data")}</p>;
  }
  return (
    <pre className="device-lineage-footprint-detail__pre device-lineage-advanced__pre">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

export function DeviceLineagePage() {
  const location = useLocation();
  const { me } = useAuth();
  const isAdmin = userIsAdmin(me?.role, me?.is_superuser);
  const { siteId: opsSiteId, refreshToken } = useOpsShell();
  const [sitesById, setSitesById] = useState<Record<string, string>>({});
  const [items, setItems] = useState<DeviceRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [footprintFilter, setFootprintFilter] = useState<string>("all");
  const [err, setErr] = useState<string | null>(null);
  useShellFeedback(err, null);

  const [detailDevice, setDetailDevice] = useState<DeviceRead | null>(null);
  const [footprint, setFootprint] = useState<DeviceFootprintRead | null>(null);
  const [footprintLoading, setFootprintLoading] = useState(false);
  const [footprintErr, setFootprintErr] = useState<string | null>(null);
  const [versionLineage, setVersionLineage] = useState<DeviceVersionLineageRead | null>(null);
  const [lineageDrawerDevice, setLineageDrawerDevice] = useState<DeviceRead | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const lineageDeepLinkSig = useRef("");
  const [summarizeOpen, setSummarizeOpen] = useState(false);
  const [footprintSummarizeInput, setFootprintSummarizeInput] = useState<DeviceFootprintPdfInput | null>(null);

  const loadSites = useCallback(async () => {
    try {
      const data = await apiFetch<SiteRow[]>("/administration/sites");
      const map: Record<string, string> = {};
      for (const s of data ?? []) map[s.id] = s.name;
      setSitesById(map);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load sites");
    }
  }, []);

  const loadDevices = useCallback(
    async (q: string) => {
      setTableLoading(true);
      setErr(null);
      try {
        const list = await listDevices({
          q: q.trim() || undefined,
          site_id: opsSiteId?.trim() || undefined,
        });
        setItems(list);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not load devices");
        setItems([]);
      } finally {
        setTableLoading(false);
        setLoading(false);
      }
    },
    [opsSiteId],
  );

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  useEffect(() => {
    void loadDevices(appliedQ);
  }, [loadDevices, appliedQ, opsSiteId, refreshToken]);

  const onSearch = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setAppliedQ(searchInput);
    },
    [searchInput],
  );

  const filtered = useMemo(() => {
    if (footprintFilter === "all") return items;
    return items.filter((d) => footprintBucket(d) === footprintFilter);
  }, [items, footprintFilter]);

  const kpi = useMemo(() => {
    let ready = 0;
    let stale = 0;
    let incomplete = 0;
    let broken = 0;
    let unknown = 0;
    let unset = 0;
    for (const d of items) {
      const b = footprintBucket(d);
      if (b === "unset") unset += 1;
      else if (b === "ready") ready += 1;
      else if (b === "stale") stale += 1;
      else if (b === "incomplete") incomplete += 1;
      else if (b === "broken") broken += 1;
      else if (b === "unknown") unknown += 1;
    }
    return { total: items.length, ready, stale, incomplete, broken, unknown, unset };
  }, [items]);

  const openFootprintSummarize = useCallback(() => {
    if (!footprint || !detailDevice) return;
    const siteLabel =
      sitesById[detailDevice.site_id]?.trim() || `${detailDevice.site_id.slice(0, 8)}…`;
    setFootprintSummarizeInput({
      generatedAtIso: new Date().toISOString(),
      deviceName: detailDevice.name,
      siteName: siteLabel,
      deviceId: detailDevice.id,
      footprint,
      lineage: versionLineage,
    });
    setSummarizeOpen(true);
  }, [footprint, detailDevice, sitesById, versionLineage]);

  const closeSummarize = useCallback(() => {
    setSummarizeOpen(false);
    setFootprintSummarizeInput(null);
  }, []);

  const openDetail = useCallback(async (d: DeviceRead) => {
    setDetailDevice(d);
    setFootprint(null);
    setVersionLineage(null);
    setFootprintErr(null);
    setFootprintLoading(true);
    try {
      const [fpRes, vlRes] = await Promise.allSettled([getDeviceFootprint(d.id), getDeviceVersionLineage(d.id)]);
      if (fpRes.status === "fulfilled") {
        setFootprint(fpRes.value);
      } else {
        const e = fpRes.reason;
        setFootprintErr(isApiHttpError(e) ? e.message : e instanceof Error ? e.message : "Could not load footprint");
      }
      if (vlRes.status === "fulfilled") setVersionLineage(vlRes.value);
      else setVersionLineage(null);
    } finally {
      setFootprintLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSummarizeOpen(false);
    setFootprintSummarizeInput(null);
    setDetailDevice(null);
    setFootprint(null);
    setVersionLineage(null);
    setFootprintErr(null);
    const next = new URLSearchParams(searchParams);
    next.delete("device");
    next.delete("footprint");
    next.delete("versionHistory");
    next.delete("compareA");
    next.delete("compareB");
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const closeLineageVersionDrawer = useCallback(() => {
    setLineageDrawerDevice(null);
    const next = new URLSearchParams(searchParams);
    next.delete("versionHistory");
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const syncKpiCompareToUrl = useCallback(
    (compareA: string, compareB: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("compareA", compareA);
      if (compareB.trim()) next.set("compareB", compareB);
      else next.delete("compareB");
      if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    const deviceId = searchParams.get("device")?.trim();
    if (!deviceId) {
      lineageDeepLinkSig.current = "";
      return;
    }
    const sig = searchParams.toString();
    if (lineageDeepLinkSig.current === sig) return;

    const wantFootprint = searchParams.get("footprint") === "1";
    const wantVersionHistory = searchParams.get("versionHistory") === "1";
    if (!wantFootprint && !wantVersionHistory) return;

    let cancelled = false;
    void (async () => {
      const row = items.find((x) => x.id === deviceId) ?? (await getDevice(deviceId).catch(() => null));
      if (cancelled || !row) return;
      if (wantFootprint) await openDetail(row);
      if (wantVersionHistory) setLineageDrawerDevice(row);
      lineageDeepLinkSig.current = sig;
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, items, openDetail]);

  useEffect(() => {
    if (!footprint || !detailDevice) return;
    if (location.hash !== "#device-lineage-kpi-heading") return;
    window.requestAnimationFrame(() => {
      document.getElementById("device-lineage-kpi-heading")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [footprint, detailDevice, location.hash]);

  return (
    <PageShell variant="list" className="device-manage-page">
      <div className="dm-root">
        <OpsPageHeader
          title="Operational Lineage"
          subtitle="Ingest → endpoint → scrubber → dashboard footprint, evaluated per device (v8 Phase 0)."
          actions={
            <Link to="/devices/register#registered-devices-table" className="dm-btn dm-btn--outline">
              Manage Devices
            </Link>
          }
        />

        <OpsKpiRow ariaLabel="Footprint summary">
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <AppIcon name="device" size="card" className="dm-kpi__label-icon" aria-hidden />
                Devices in scope
              </div>
              <div className="dm-kpi__value">{kpi.total}</div>
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Ready</div>
              <div className="dm-kpi__value">{kpi.ready}</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--online" aria-hidden>
              <AppIcon name="online" size="card" aria-hidden />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Stale</div>
              <div className="dm-kpi__value">{kpi.stale}</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--muted" aria-hidden>
              <AppIcon name="degraded" size="card" aria-hidden />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Incomplete / broken</div>
              <div className="dm-kpi__value">{kpi.incomplete + kpi.broken}</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--error" aria-hidden>
              <AppIcon name="offline" size="card" aria-hidden />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Unknown / unset</div>
              <div className="dm-kpi__value">{kpi.unknown + kpi.unset}</div>
            </div>
          </div>
        </OpsKpiRow>

        <OpsFilterPanel ariaLabel="Search and footprint filter">
          <form className="dm-controls-form" onSubmit={onSearch}>
            <div className="dm-controls-form__row">
              <OpsScopeControls variant="filters" timeRangeLabel="Range" />
              <div className="dm-search-wrap">
                <Search size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                <input
                  className="dm-search-input"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search by name or description…"
                  aria-label="Search devices"
                />
              </div>
              <div className="dm-filter-field">
                <label htmlFor="dm-lineage-fp">Operational footprint</label>
                <select
                  id="dm-lineage-fp"
                  value={footprintFilter}
                  onChange={(e) => setFootprintFilter(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="ready">Ready</option>
                  <option value="stale">Stale</option>
                  <option value="incomplete">Incomplete</option>
                  <option value="broken">Broken</option>
                  <option value="unknown">Unknown</option>
                  <option value="unset">Not evaluated</option>
                </select>
              </div>
              <button type="submit" className="dm-btn dm-btn--primary dm-btn--search" disabled={tableLoading}>
                Search
              </button>
            </div>
          </form>
        </OpsFilterPanel>

        <OpsDataTable>
          <div className="dm-device-table-shell" aria-busy={tableLoading}>
            {tableLoading ? <p className="dm-table-loading">Loading…</p> : null}
            {!loading && !tableLoading && filtered.length === 0 ? (
              <p className="dm-data-table__empty">No devices match the current filters.</p>
            ) : null}
            {filtered.length > 0 ? (
              <div className="dm-table-scroll">
                <table className="dm-data-table">
                  <thead>
                    <tr>
                      <th className="dm-data-table__th" scope="col">
                        Device
                      </th>
                      <th className="dm-data-table__th" scope="col">
                        Site
                      </th>
                      <th className="dm-data-table__th" scope="col">
                        Protocol
                      </th>
                      <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                        Footprint
                      </th>
                      <th className="dm-data-table__th" scope="col">
                        Recommendation
                      </th>
                      <th className="dm-data-table__th" scope="col">
                        Message
                      </th>
                      {isAdmin ? (
                        <th className="dm-data-table__th dm-data-table__th--actions" scope="col">
                          Actions
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d) => {
                      const siteLabel = sitesById[d.site_id] ?? `${d.site_id.slice(0, 8)}…`;
                      const msg = d.footprint_recommendation_message?.trim() ?? "";
                      return (
                        <tr key={d.id} className="dm-data-table__row">
                          <td className="dm-data-table__td">
                            <Link className="dm-name-link" to={`/devices/manage?device=${encodeURIComponent(d.id)}`}>
                              {d.name}
                            </Link>
                          </td>
                          <td className="dm-data-table__td">
                            <small>{siteLabel}</small>
                          </td>
                          <td className="dm-data-table__td">{protocolLabel(d)}</td>
                          <td className="dm-data-table__td dm-data-table__td--center">
                            <span title={d.footprint_recommendation_message ?? undefined}>
                              {d.footprint_operational_status?.trim() ? (
                                <OpsStatusPill
                                  status={d.footprint_operational_status}
                                  variant={footprintOperationalPillVariant(d.footprint_operational_status)}
                                />
                              ) : (
                                <OpsStatusPill status="—" variant="muted" />
                              )}
                            </span>
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--muted" style={{ fontSize: "0.78rem" }}>
                            {d.footprint_recommendation_code?.trim() ? (
                              <OpsStatusPill
                                status={d.footprint_recommendation_code.trim().toLowerCase()}
                                variant={footprintRecommendationPillVariant(d.footprint_recommendation_code)}
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--muted" style={{ fontSize: "0.78rem" }} title={msg}>
                            {msg.length > 120 ? `${msg.slice(0, 120)}…` : msg || "—"}
                          </td>
                          {isAdmin ? (
                            <td className="dm-data-table__td dm-data-table__td--actions">
                              <OpsActionButton
                                tone="plain"
                                className="device-lineage-footprint-icon-btn"
                                title="Footprint detail"
                                aria-label={`Footprint detail for ${d.name}`}
                                onClick={() => void openDetail(d)}
                              >
                                <Footprints size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                              </OpsActionButton>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </OpsDataTable>
      </div>

      <AppModalShell
        open={Boolean(detailDevice)}
        onClose={closeDetail}
        title={detailDevice ? `Footprint — ${detailDevice.name}` : "Footprint"}
        titleId="device-lineage-footprint-title"
        subtitle="Structured view from GET /devices/{id}/footprint"
        size="xl"
        dialogClassName="device-lineage-footprint-modal"
      >
        {footprintLoading ? <p className="dash-widget__muted">Loading footprint…</p> : null}
        {footprintErr ? <p style={{ color: "var(--page-status-error-fg)" }}>{footprintErr}</p> : null}
        {!footprintLoading && footprint ? (
          <FootprintDetailSections
            fp={footprint}
            deviceRow={detailDevice}
            siteName={detailDevice ? (sitesById[detailDevice.site_id] ?? null) : null}
            lineage={versionLineage}
            versionHistoryRegisterUrl={
              detailDevice ?
                deviceRegisterVersionHistoryUrl(detailDevice.id, {
                  compareA: searchParams.get("compareA") ?? undefined,
                  compareB: searchParams.get("compareB") ?? undefined,
                })
              : null
            }
            onSummarize={openFootprintSummarize}
            initialCompareA={searchParams.get("compareA")}
            initialCompareB={searchParams.get("compareB")}
            onKpiCompareUrlSync={syncKpiCompareToUrl}
          />
        ) : null}
      </AppModalShell>

      <DeviceVersionHistoryDrawer
        open={Boolean(lineageDrawerDevice)}
        device={lineageDrawerDevice}
        siteName={
          lineageDrawerDevice ?
            sitesById[lineageDrawerDevice.site_id]?.trim() || `${lineageDrawerDevice.site_id.slice(0, 8)}…`
          : "—"
        }
        onClose={closeLineageVersionDrawer}
      />

      {summarizeOpen && footprintSummarizeInput ? (
        <LineageSummarizeModal open={summarizeOpen} onClose={closeSummarize} pdfInput={footprintSummarizeInput} />
      ) : null}
    </PageShell>
  );
}
