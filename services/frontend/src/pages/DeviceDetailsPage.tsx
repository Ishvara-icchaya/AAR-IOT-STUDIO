import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { GitCompare, Info, PlayCircle, Radar } from "lucide-react";
import { isApiHttpError } from "@/api/client";
import { runReplaySimulation, type SimulationJobRead } from "@/api/simulations";
import {
  deviceLineageFootprintUrl,
  getDevice,
  getDeviceFootprint,
  getDeviceOtaTargetHistory,
  getDeviceVersionImpact,
  getDeviceVersionLineage,
  isolateDeviceVersion,
  listDeviceVersionSnapshots,
  promoteDeviceVersion,
  rollbackDeviceVersion,
  deprecateDeviceVersion,
  type DeviceDetailsTab,
  type DeviceFootprintRead,
  type DeviceRead,
  type DeviceVersionImpactRead,
  type DeviceVersionLineageRead,
  type DeviceVersionSnapshot,
  type OtaTargetHistoryItem,
} from "@/api/devices";
import { AppToolbar } from "@/components/app";
import { AppModalShell } from "@/components/app/AppModalShell";
import { OpsActionButton } from "@/components/ops/OpsActionButton";
import { OpsStatusPill } from "@/components/ops/OpsStatusPill";
import { AarButton } from "@/components/system/AarButton";
import { PageShell } from "@/layouts/PageShell";
import { useSitePermissionKeys } from "@/hooks/useSitePermissionKeys";
import { useShellMessage } from "@/layouts/shell/ShellMessageContext";
import { footprintOperationalPillVariant } from "@/lib/deviceOperationalFootprintUi";
import {
  formatFirmwareChannelLabel,
  formatVersionStatusLabel,
  normalizeFirmwareChannel,
  normalizeVersionStatus,
  versionStatusPillSuffix,
} from "@/lib/deviceVersionUi";
import { ICON_SIZES, ICON_STROKE_WIDTH } from "@/lib/appIcons";

import "./device-details-page.css";

const DETAIL_TABS: readonly { id: DeviceDetailsTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "versions", label: "Versions" },
  { id: "lineage", label: "Lineage" },
  { id: "ota", label: "OTA History" },
  { id: "simulation", label: "Simulation" },
] as const;

function parseTab(raw: string | null): DeviceDetailsTab {
  const allowed = new Set(DETAIL_TABS.map((t) => t.id));
  if (raw && allowed.has(raw as DeviceDetailsTab)) return raw as DeviceDetailsTab;
  return "overview";
}

const FIELD_LABELS: Record<string, string> = {
  version_label: "Version label",
  firmware_version: "Firmware",
  hardware_version: "Hardware",
  config_version: "Config",
  endpoint_version: "Endpoint",
  scrubber_version: "Scrubber",
  schema_version: "Schema",
  manifest_hash: "Manifest hash",
  firmware_channel: "Firmware channel",
  routing_lane: "Routing lane",
  compatibility: "Compatibility",
  status: "Lifecycle status",
  version_source: "Version source",
};

export function DeviceDetailsPage() {
  const navigate = useNavigate();
  const { deviceId = "" } = useParams<{ deviceId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);
  const setTab = useCallback(
    (next: DeviceDetailsTab) => {
      if (next === "overview") setSearchParams({}, { replace: true });
      else setSearchParams({ tab: next }, { replace: true });
    },
    [setSearchParams],
  );

  const { pushMessage } = useShellMessage();
  const [device, setDevice] = useState<DeviceRead | null>(null);
  const sitePerm = useSitePermissionKeys(device?.site_id);
  const [footprint, setFootprint] = useState<DeviceFootprintRead | null>(null);
  const [snapshots, setSnapshots] = useState<DeviceVersionSnapshot[]>([]);
  const [lineage, setLineage] = useState<DeviceVersionLineageRead | null>(null);
  const [otaRows, setOtaRows] = useState<OtaTargetHistoryItem[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState<DeviceVersionImpactRead | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const [impactErr, setImpactErr] = useState<string | null>(null);
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null);
  const [simJob, setSimJob] = useState<SimulationJobRead | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [simErr, setSimErr] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");

  const permReady = Boolean(device?.site_id && !sitePerm.loading);
  const canRunSimulation = permReady && sitePerm.has("simulation.run");
  const canDeviceVersionsRead = permReady && sitePerm.has("device_versions.read");
  const canPromote = permReady && sitePerm.has("device_versions.promote");
  const canIsolate = permReady && sitePerm.has("device_versions.isolate");
  const canRollback = permReady && sitePerm.has("device_versions.rollback");
  const canDeprecate = permReady && sitePerm.has("device_versions.deprecate");
  const canLineage = permReady && (sitePerm.has("lineage.read") || sitePerm.has("devices.footprint.read"));
  const canOtaRead = permReady && sitePerm.has("ota.read");

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    void (async () => {
      setBusy(true);
      setLoadErr(null);
      try {
        const d = await getDevice(deviceId);
        if (cancelled) return;
        setDevice(d);
      } catch (e) {
        if (!cancelled) setLoadErr(isApiHttpError(e) ? e.message : "Failed to load device");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId || tab !== "overview") return;
    let cancelled = false;
    void (async () => {
      try {
        const fp = await getDeviceFootprint(deviceId);
        if (!cancelled) setFootprint(fp);
      } catch {
        if (!cancelled) setFootprint(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId, tab]);

  useEffect(() => {
    if (!deviceId || (tab !== "versions" && tab !== "lineage")) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await listDeviceVersionSnapshots(deviceId);
        if (!cancelled) setSnapshots(res?.items ?? []);
      } catch {
        if (!cancelled) setSnapshots([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId, tab]);

  useEffect(() => {
    if (!deviceId || tab !== "lineage") return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await getDeviceVersionLineage(deviceId);
        if (!cancelled) setLineage(data);
      } catch {
        if (!cancelled) setLineage(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId, tab]);

  useEffect(() => {
    if (!deviceId || tab !== "ota") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await getDeviceOtaTargetHistory(deviceId);
        if (!cancelled) setOtaRows(res?.items ?? []);
      } catch {
        if (!cancelled) setOtaRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId, tab]);

  const labelOptions = useMemo(() => {
    const fromSnaps = snapshots.map((s) => s.version_label).filter(Boolean);
    const fromLineage = (lineage?.versions ?? []).map((v) => v.version_label).filter(Boolean);
    return Array.from(new Set([...fromSnaps, ...fromLineage])).sort();
  }, [snapshots, lineage]);

  const runImpact = useCallback(
    async (versionId: string) => {
      if (!deviceId) return;
      setImpactBusy(true);
      setImpactErr(null);
      setImpact(null);
      try {
        const data = await getDeviceVersionImpact(deviceId, versionId);
        setImpact(data);
      } catch (e) {
        setImpactErr(isApiHttpError(e) ? e.message : "Impact request failed");
      } finally {
        setImpactBusy(false);
      }
    },
    [deviceId],
  );

  const onLifecycle = useCallback(
    async (kind: "promote" | "isolate" | "rollback" | "deprecate", versionId: string) => {
      setLifecycleBusyId(versionId);
      try {
        if (kind === "promote") await promoteDeviceVersion(versionId);
        else if (kind === "isolate") await isolateDeviceVersion(versionId);
        else if (kind === "rollback") await rollbackDeviceVersion(versionId);
        else await deprecateDeviceVersion(versionId);
        pushMessage(
          "success",
          `${kind === "promote" ? "Promoted" : kind === "isolate" ? "Isolated" : kind === "rollback" ? "Rolled back" : "Deprecated"} version.`,
        );
        const d = await getDevice(deviceId);
        setDevice(d);
        const res = await listDeviceVersionSnapshots(deviceId);
        setSnapshots(res?.items ?? []);
        setImpact(null);
      } catch (e) {
        pushMessage("error", isApiHttpError(e) ? e.message : "Lifecycle action failed");
      } finally {
        setLifecycleBusyId(null);
      }
    },
    [deviceId, pushMessage],
  );

  const onRunSimulation = useCallback(async () => {
    if (!deviceId || !canRunSimulation) return;
    setSimBusy(true);
    setSimErr(null);
    try {
      const job = await runReplaySimulation({
        device_id: deviceId,
        scope_hours: 168,
        sample_size: 200,
      });
      setSimJob(job);
      pushMessage("success", "Replay simulation finished.");
    } catch (e) {
      setSimErr(isApiHttpError(e) ? e.message : "Simulation failed");
    } finally {
      setSimBusy(false);
    }
  }, [deviceId, canRunSimulation, pushMessage]);

  const onCompareNavigate = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!deviceId || !compareA.trim() || !compareB.trim()) return;
      window.location.assign(
        deviceLineageFootprintUrl(deviceId, {
          compareA: compareA.trim(),
          compareB: compareB.trim(),
          kpiAnchor: true,
        }),
      );
    },
    [deviceId, compareA, compareB],
  );

  if (!deviceId) {
    return (
      <PageShell>
        <p className="device-details-page__sub">Missing device id.</p>
        <Link to="/devices/register">Back to registration</Link>
      </PageShell>
    );
  }

  const closeDetails = () => {
    navigate("/devices/register");
  };

  return (
    <PageShell variant="list" className="device-manage-page">
      <AppModalShell
        open
        onClose={closeDetails}
        title="Device details"
        subtitle={device ? `${device.name} · ${device.id.slice(0, 8)}…` : undefined}
        size="xl"
        titleId="device-details-modal-title"
        dialogClassName="device-endpoint-config-modal device-details-modal"
      >
        <div className="device-details-page device-details-page--modal">
          <AppToolbar
            className="device-endpoint-drawer-toolbar"
            left={
              <nav className="device-endpoint-drawer__subnav" aria-label="Device details navigation">
                <Link to="/devices/register#registered-devices-table" className="device-endpoint-drawer__device-list-link" onClick={closeDetails}>
                  Device list
                </Link>
                <span className="device-endpoint-drawer__subnav-hint"> / Manage Devices</span>
              </nav>
            }
            right={null}
          />

          {loadErr ? (
            <p className="device-details-page__sub" role="alert">
              {loadErr}
            </p>
          ) : null}
          {busy && !device ? <p className="device-details-page__sub">Loading device…</p> : null}

          {device ? (
            <>
              <div className="monitoring-page__tabs device-lineage-detail-tabs" role="region" aria-label="Device details sections">
                <div className="device-lineage-detail-tabs__bar" role="tablist" aria-label="Device details tabs">
                  {DETAIL_TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.id}
                      id={`device-detail-tab-${t.id}`}
                      className={`device-lineage-detail-tabs__tab${tab === t.id ? " device-lineage-detail-tabs__tab--active" : ""}`}
                      onClick={() => setTab(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="device-details-page__tab-panels">
                {tab === "overview" ? (
              <section className="device-details-page__section" aria-labelledby="dd-overview-h">
                <h2 id="dd-overview-h" className="dm-sr-only">
                  Overview
                </h2>
                <p className="device-details-page__sub">
                  Identity and readiness stay on{" "}
                  <Link to="/devices/register">registration</Link>; this hub focuses on versions, lineage, impact, and OTA.
                </p>
                <div className="device-details-page__grid">
                  <div className="device-details-page__card">
                    <div className="device-details-page__card-label">Site</div>
                    <div className="device-details-page__card-value">{device.site_id.slice(0, 8)}…</div>
                  </div>
                  <div className="device-details-page__card">
                    <div className="device-details-page__card-label">Firmware</div>
                    <div className="device-details-page__card-value">{device.firmware_version?.trim() || "—"}</div>
                  </div>
                  <div className="device-details-page__card">
                    <div className="device-details-page__card-label">Channel</div>
                    <div className="device-details-page__card-value">
                      {formatFirmwareChannelLabel(normalizeFirmwareChannel(device.firmware_channel))}
                    </div>
                  </div>
                  <div className="device-details-page__card">
                    <div className="device-details-page__card-label">Device version label</div>
                    <div className="device-details-page__card-value">{device.device_version ?? "1"}</div>
                  </div>
                  <div className="device-details-page__card">
                    <div className="device-details-page__card-label">Version status</div>
                    <div className="device-details-page__card-value">
                      <span className={`dm-version-pill dm-version-pill--status-${versionStatusPillSuffix(normalizeVersionStatus(device.version_status))}`}>
                        {formatVersionStatusLabel(normalizeVersionStatus(device.version_status))}
                      </span>
                    </div>
                  </div>
                  <div className="device-details-page__card">
                    <div className="device-details-page__card-label">OTA / rollback</div>
                    <div className="device-details-page__card-value">
                      OTA {device.ota_supported ? "on" : "off"} · Rollback {device.rollback_supported ? "on" : "off"}
                    </div>
                  </div>
                </div>
                {footprint ? (
                  <div className="device-details-page__card" style={{ maxWidth: 560 }}>
                    <div className="device-details-page__card-label">Operational footprint</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                      <OpsStatusPill status={footprint.status} variant={footprintOperationalPillVariant(footprint.status)} />
                      <span style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>{footprint.recommendation.message}</span>
                    </div>
                  </div>
                ) : (
                  <p className="device-details-page__sub">Footprint not available (check devices.footprint.read).</p>
                )}
              </section>
            ) : null}

            {tab === "versions" ? (
              <section className="device-details-page__section" aria-labelledby="dd-versions-h">
                <h2 id="dd-versions-h" className="dm-sr-only">
                  Versions
                </h2>
                <p className="device-details-page__sub">
                  Immutable <code>device_versions</code> rows. Promote / isolate / rollback call the lifecycle API; impact uses the prior{" "}
                  <strong>active</strong> row as baseline (Phase&nbsp;9).
                </p>
                {device && !canDeviceVersionsRead ? (
                  <p className="device-details-page__sub" role="status">
                    You need <code>device_versions.read</code> for this device&apos;s site to load snapshots and impact.
                  </p>
                ) : null}
                {snapshots.length === 0 ? (
                  <p className="device-details-page__sub">No version snapshots yet.</p>
                ) : (
                  <div className="dm-table-scroll">
                    <table className="dm-data-table">
                      <thead>
                        <tr>
                          <th className="dm-data-table__th">Label</th>
                          <th className="dm-data-table__th">Status</th>
                          <th className="dm-data-table__th">Lane</th>
                          <th className="dm-data-table__th">Schema</th>
                          <th className="dm-data-table__th">Created</th>
                          <th className="dm-data-table__th dm-data-table__th--actions">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshots.map((s) => (
                          <tr key={s.id} className="dm-data-table__row">
                            <td className="dm-data-table__td">{s.version_label}</td>
                            <td className="dm-data-table__td">
                              <span className={`dm-version-pill dm-version-pill--status-${versionStatusPillSuffix(normalizeVersionStatus(s.status))}`}>
                                {formatVersionStatusLabel(normalizeVersionStatus(s.status))}
                              </span>
                            </td>
                            <td className="dm-data-table__td">{s.routing_lane}</td>
                            <td className="dm-data-table__td">{s.schema_version?.trim() || "—"}</td>
                            <td className="dm-data-table__td dm-data-table__td--muted">{new Date(s.created_at).toLocaleString()}</td>
                            <td className="dm-data-table__td dm-data-table__td--actions">
                              <div className="device-details-page__row-actions">
                                <OpsActionButton
                                  tone="plain"
                                  title="View static impact"
                                  aria-label={`Impact for version ${s.version_label}`}
                                  disabled={impactBusy || !canDeviceVersionsRead}
                                  onClick={() => void runImpact(s.id)}
                                >
                                  <Radar size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                                </OpsActionButton>
                                <AarButton
                                  className="device-details-page__mini-action"
                                  variant="outline"
                                  disabled={lifecycleBusyId === s.id || !canPromote}
                                  title={!canPromote ? "Requires device_versions.promote" : undefined}
                                  onClick={() => void onLifecycle("promote", s.id)}
                                >
                                  Promote
                                </AarButton>
                                <AarButton
                                  className="device-details-page__mini-action"
                                  variant="outline"
                                  disabled={lifecycleBusyId === s.id || !canIsolate}
                                  title={!canIsolate ? "Requires device_versions.isolate" : undefined}
                                  onClick={() => void onLifecycle("isolate", s.id)}
                                >
                                  Isolate
                                </AarButton>
                                <AarButton
                                  className="device-details-page__mini-action"
                                  variant="outline"
                                  disabled={lifecycleBusyId === s.id || !canRollback}
                                  title={!canRollback ? "Requires device_versions.rollback" : undefined}
                                  onClick={() => void onLifecycle("rollback", s.id)}
                                >
                                  Rollback
                                </AarButton>
                                {canDeprecate &&
                                !["deprecated", "rolled_back"].includes((s.status || "").toLowerCase()) &&
                                !(s.routing_lane === "shared" && (s.status || "").toLowerCase() === "active") ? (
                                  <AarButton
                                    className="device-details-page__mini-action"
                                    variant="outline"
                                    disabled={lifecycleBusyId === s.id}
                                    onClick={() => void onLifecycle("deprecate", s.id)}
                                  >
                                    Deprecate
                                  </AarButton>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {impactErr ? (
                  <p className="device-details-page__sub" role="alert">
                    {impactErr}
                  </p>
                ) : null}
                {impactBusy ? <p className="device-details-page__sub">Computing impact…</p> : null}
                {impact ? (
                  <div className="device-details-page__impact">
                    <strong>Impact</strong> for candidate <code>{impact.candidate_id.slice(0, 8)}…</code>
                    {impact.baseline_id ? (
                      <>
                        {" "}
                        vs baseline <code>{impact.baseline_id.slice(0, 8)}…</code>
                      </>
                    ) : (
                      <> — no prior active baseline</>
                    )}
                    {impact.notes.map((n) => (
                      <p key={n.code} className="device-details-page__note">
                        <Info size={14} style={{ verticalAlign: "text-bottom", marginRight: 6 }} aria-hidden />
                        {n.message}
                      </p>
                    ))}
                    <table className="device-details-page__diff-table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Baseline</th>
                          <th>Candidate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {impact.field_diff
                          .filter((d) => d.changed)
                          .map((d) => (
                            <tr key={d.field} className="changed">
                              <td>{FIELD_LABELS[d.field] ?? d.field}</td>
                              <td>{d.baseline ?? "—"}</td>
                              <td>{d.candidate ?? "—"}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {impact.field_diff.every((d) => !d.changed) ? (
                      <p className="device-details-page__sub">No field differences vs baseline.</p>
                    ) : null}
                    <h3 className="device-details-page__card-label" style={{ marginTop: "1rem" }}>
                      Workflows (static graph)
                    </h3>
                    <ul style={{ margin: "4px 0 0 1rem" }}>
                      {impact.workflows.length === 0 ? <li className="device-details-page__sub">None reference this device.</li> : null}
                      {impact.workflows.map((w) => (
                        <li key={w.id}>
                          <Link to={`/workflow/${w.id}/edit`}>{w.name}</Link>{" "}
                          <span style={{ color: "var(--color-text-muted)" }}>({w.lifecycle_status})</span>
                        </li>
                      ))}
                    </ul>
                    <h3 className="device-details-page__card-label" style={{ marginTop: "1rem" }}>
                      Dashboards
                    </h3>
                    <ul style={{ margin: "4px 0 0 1rem" }}>
                      {impact.dashboards.length === 0 ? <li className="device-details-page__sub">None reference this device.</li> : null}
                      {impact.dashboards.map((d) => (
                        <li key={d.id}>
                          <Link to={`/dashboard/${encodeURIComponent(d.id)}/edit`}>{d.name}</Link>{" "}
                          <span style={{ color: "var(--color-text-muted)" }}>({d.status})</span>
                        </li>
                      ))}
                    </ul>
                    {impact.catalog_attribute_ids.length > 0 ? (
                      <p className="device-details-page__sub dash-widget__muted" style={{ marginTop: "0.75rem" }}>
                        Field catalog attribute ids ({impact.catalog_attribute_ids.length}):{" "}
                        {impact.catalog_attribute_ids.slice(0, 16).join(", ")}
                        {impact.catalog_attribute_ids.length > 16 ? "…" : ""}
                      </p>
                    ) : (
                      <p className="device-details-page__sub dash-widget__muted" style={{ marginTop: "0.75rem" }}>
                        No attribute ids in device field catalog (mapping may be empty).
                      </p>
                    )}
                    {impact.widget_attribute_impact.length > 0 ? (
                      <>
                        <h3 className="device-details-page__card-label" style={{ marginTop: "1rem" }}>
                          Widget bindings vs catalog
                        </h3>
                        <div className="dm-table-scroll">
                          <table className="device-details-page__diff-table">
                            <thead>
                              <tr>
                                <th>Dashboard</th>
                                <th>Widget</th>
                                <th>Attributes / metrics</th>
                                <th>Missing from catalog</th>
                              </tr>
                            </thead>
                            <tbody>
                              {impact.widget_attribute_impact.map((w, i) => (
                                <tr
                                  key={`${w.dashboard_id}-${w.widget_id ?? i}`}
                                  className={w.review_recommended ? "changed" : ""}
                                >
                                  <td>
                                    <Link to={`/dashboard/${encodeURIComponent(w.dashboard_id)}/edit`}>{w.dashboard_name}</Link>
                                  </td>
                                  <td>
                                    <span title={w.widget_title}>{w.widget_type ?? "—"}</span>{" "}
                                    {w.widget_id ? <code className="dash-widget__muted">{w.widget_id.slice(0, 8)}…</code> : null}
                                  </td>
                                  <td>{w.attribute_ids.length ? w.attribute_ids.join(", ") : "—"}</td>
                                  <td>{w.missing_from_catalog.length ? w.missing_from_catalog.join(", ") : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {tab === "lineage" ? (
              <section className="device-details-page__section" aria-labelledby="dd-lineage-h">
                <h2 id="dd-lineage-h" className="dm-sr-only">
                  Lineage
                </h2>
                {!canLineage && device ? (
                  <p className="device-details-page__sub" role="status">
                    You need <code>lineage.read</code> or <code>devices.footprint.read</code> for this site.
                  </p>
                ) : null}
                <p className="device-details-page__sub">
                  <Link to={deviceLineageFootprintUrl(deviceId)}>Open full lineage workspace</Link> with footprint and KPI compare.
                </p>
                <form className="device-details-page__toolbar" onSubmit={onCompareNavigate}>
                  <GitCompare size={16} aria-hidden />
                  <label>
                    <span className="dm-sr-only">Compare A</span>
                    <select value={compareA} onChange={(e) => setCompareA(e.target.value)} aria-label="Compare version A">
                      <option value="">Version A…</option>
                      {labelOptions.map((lb) => (
                        <option key={`a-${lb}`} value={lb}>
                          {lb}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span aria-hidden>vs</span>
                  <label>
                    <span className="dm-sr-only">Compare B</span>
                    <select value={compareB} onChange={(e) => setCompareB(e.target.value)} aria-label="Compare version B">
                      <option value="">Version B…</option>
                      {labelOptions.map((lb) => (
                        <option key={`b-${lb}`} value={lb}>
                          {lb}
                        </option>
                      ))}
                    </select>
                  </label>
                  <AarButton type="submit" variant="primary" disabled={!compareA.trim() || !compareB.trim()}>
                    Compare on lineage page
                  </AarButton>
                </form>
                {!lineage?.versions?.length ? (
                  <p className="device-details-page__sub">No lineage rows (or missing footprint.read).</p>
                ) : (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {lineage.versions.map((v) => (
                      <li key={v.id} className="device-details-page__card" style={{ marginBottom: 8 }}>
                        <strong>v{v.version_label}</strong>
                        {v.is_current ? " · current" : ""}
                        <div style={{ color: "var(--color-text-muted)", fontSize: "0.88rem" }}>
                          {v.trigger_code}
                          {v.recorded_at ? ` · ${new Date(v.recorded_at).toLocaleString()}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {tab === "ota" ? (
              <section className="device-details-page__section" aria-labelledby="dd-ota-h">
                <h2 id="dd-ota-h" className="dm-sr-only">
                  OTA history
                </h2>
                {!canOtaRead && device ? (
                  <p className="device-details-page__sub" role="status">
                    You need <code>ota.read</code> for this device&apos;s site.
                  </p>
                ) : null}
                <p className="device-details-page__sub">
                  Read-only history of OTA campaign targets for this device (requires <code>ota.read</code>). To start a rollout, go to{" "}
                  <Link to="/devices/register#registered-devices-table">Manage Devices</Link> and use the rocket icon in the row Actions column, or open{" "}
                  <Link to="/devices/ota">OTA campaigns</Link> from the top nav (opens as a modal).
                </p>
                {otaRows.length === 0 ? (
                  <p className="device-details-page__sub">No OTA targets recorded yet.</p>
                ) : (
                  <div className="dm-table-scroll">
                    <table className="dm-data-table">
                      <thead>
                        <tr>
                          <th className="dm-data-table__th">Campaign</th>
                          <th className="dm-data-table__th">Campaign status</th>
                          <th className="dm-data-table__th">Target status</th>
                          <th className="dm-data-table__th">Target FW</th>
                          <th className="dm-data-table__th">Completed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {otaRows.map((r) => (
                          <tr key={r.target_id} className="dm-data-table__row">
                            <td className="dm-data-table__td">{r.campaign_name}</td>
                            <td className="dm-data-table__td">{r.campaign_status}</td>
                            <td className="dm-data-table__td">{r.target_status}</td>
                            <td className="dm-data-table__td">{r.target_firmware_version?.trim() || "—"}</td>
                            <td className="dm-data-table__td dm-data-table__td--muted">
                              {r.completed_at ? new Date(r.completed_at).toLocaleString() : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ) : null}

            {tab === "simulation" ? (
              <section className="device-details-page__section" aria-labelledby="dd-sim-h">
                <h2 id="dd-sim-h" className="dm-sr-only">
                  Simulation
                </h2>
                <p className="device-details-page__sub">
                  <PlayCircle size={18} style={{ verticalAlign: "text-bottom", marginRight: 6 }} aria-hidden />
                  <strong>Replay simulation</strong> samples recent scrubbed telemetry for this device, compares structural shape across
                  the window, estimates KPI drift, and runs static workflow/dashboard impact for the candidate version.
                </p>
                {!canRunSimulation && device && permReady ? (
                  <p className="device-details-page__sub">You need the <code>simulation.run</code> permission for this device&apos;s site.</p>
                ) : null}
                {simErr ? <p className="device-details-page__sub device-details-page__err">{simErr}</p> : null}
                <div className="device-details-page__toolbar">
                  <AarButton type="button" variant="primary" disabled={!deviceId || !canRunSimulation || simBusy} onClick={() => void onRunSimulation()}>
                    {simBusy ? "Running…" : "Run replay simulation"}
                  </AarButton>
                </div>
                {simJob ?
                  <div className="device-details-page__sim-result">
                    <h3 className="device-details-page__subhead">Last job</h3>
                    <dl className="device-details-page__dl">
                      <dt>Status</dt>
                      <dd>{simJob.status}</dd>
                      <dt>Window</dt>
                      <dd>
                        {new Date(simJob.window_start).toLocaleString()} → {new Date(simJob.window_end).toLocaleString()}
                      </dd>
                      <dt>Sample cap</dt>
                      <dd>{simJob.sample_size}</dd>
                      <dt>Records tested</dt>
                      <dd>{simJob.records_tested}</dd>
                      <dt>Passed / failed</dt>
                      <dd>
                        {simJob.records_passed} / {simJob.records_failed}
                      </dd>
                    </dl>
                    {simJob.error_message ?
                      <p className="device-details-page__sub">{simJob.error_message}</p>
                    : null}
                    {typeof simJob.result_json?.recommendation === "string" ?
                      <p className="device-details-page__sub">{simJob.result_json.recommendation as string}</p>
                    : null}
                    {Array.isArray(simJob.result_json?.field_diff) ?
                      <p className="device-details-page__sub dash-widget__muted">
                        Field shape deltas (oldest vs newest sample): {(simJob.result_json.field_diff as unknown[]).length} row(s).
                      </p>
                    : null}
                  </div>
                : null}
              </section>
            ) : null}
              </div>
          </>
        ) : null}
        </div>
      </AppModalShell>
    </PageShell>
  );
}
