import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Ban, CircleArrowUp, GitCompare, PlayCircle } from "lucide-react";
import { isApiHttpError } from "@/api/client";
import { runReplaySimulation, type SimulationJobRead } from "@/api/simulations";
import {
  createManualDeviceVersionDraft,
  deviceLineageFootprintUrl,
  getDevice,
  getDeviceFootprint,
  getDeviceVersionLineage,
  listDeviceVersionSnapshots,
  promoteDeviceVersion,
  submitDeviceVersionDraft,
  deprecateDeviceVersion,
  updateDevice,
  type DeviceDetailsTab,
  type DeviceFootprintRead,
  type DeviceRead,
  type DeviceVersionLineageRead,
  type DeviceVersionSnapshot,
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
  DEVICE_VERSION_STATUS_UI_OPTIONS,
  formatFirmwareChannelLabel,
  formatVersionStatusLabel,
  normalizeFirmwareChannel,
  normalizeVersionStatus,
  versionStatusPillSuffix,
} from "@/lib/deviceVersionUi";
import { ICON_SIZES, ICON_STROKE_WIDTH } from "@/lib/appIcons";
import { deriveDataPipelineLabel, deriveDeviceStatusLabel } from "@/lib/deviceDetailsIngestUi";

import "./device-details-page.css";

const DETAIL_TABS: readonly { id: DeviceDetailsTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "ingest", label: "Ingest" },
  { id: "versions", label: "Versions" },
  { id: "lineage", label: "Lineage" },
  { id: "simulation", label: "Simulation" },
] as const;

function parseTab(raw: string | null): DeviceDetailsTab {
  const allowed = new Set(DETAIL_TABS.map((t) => t.id));
  if (raw && allowed.has(raw as DeviceDetailsTab)) return raw as DeviceDetailsTab;
  return "overview";
}

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
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null);
  const [simJob, setSimJob] = useState<SimulationJobRead | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [simErr, setSimErr] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");
  const [addVersionOpen, setAddVersionOpen] = useState(false);
  const [addVersionBusy, setAddVersionBusy] = useState(false);
  const [avLabel, setAvLabel] = useState("");
  const [avNotes, setAvNotes] = useState("");
  const [avFw, setAvFw] = useState("");
  const [avSw, setAvSw] = useState("");
  const [avCfg, setAvCfg] = useState("");

  const [trafficDeviceActive, setTrafficDeviceActive] = useState(true);
  const [trafficVersionStatus, setTrafficVersionStatus] = useState<string>("active");
  const [trafficBusy, setTrafficBusy] = useState(false);

  const permReady = Boolean(device?.site_id && !sitePerm.loading);
  const canRunSimulation = permReady && sitePerm.has("simulation.run");
  const canDeviceVersionsRead = permReady && sitePerm.has("device_versions.read");
  const canPromote = permReady && sitePerm.has("device_versions.promote");
  const canDeprecate = permReady && sitePerm.has("device_versions.deprecate");
  const canLineage = permReady && (sitePerm.has("lineage.read") || sitePerm.has("devices.footprint.read"));
  const canDeviceWrite = permReady && sitePerm.has("devices.write");

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
    if (!device) return;
    setTrafficDeviceActive(device.is_active !== false);
    setTrafficVersionStatus(normalizeVersionStatus(device.version_status));
  }, [device?.id, device?.is_active, device?.version_status]);

  useEffect(() => {
    if (!deviceId || (tab !== "overview" && tab !== "versions" && tab !== "ingest")) return;
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

  const trafficDirty = useMemo(() => {
    if (!device) return false;
    return (
      trafficDeviceActive !== device.is_active ||
      normalizeVersionStatus(trafficVersionStatus) !== normalizeVersionStatus(device.version_status)
    );
  }, [device, trafficDeviceActive, trafficVersionStatus]);

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

  const labelOptions = useMemo(() => {
    const fromSnaps = snapshots.map((s) => s.version_label).filter(Boolean);
    const fromLineage = (lineage?.versions ?? []).map((v) => v.version_label).filter(Boolean);
    return Array.from(new Set([...fromSnaps, ...fromLineage])).sort();
  }, [snapshots, lineage]);

  const latestSnapshotForCopy = useMemo(() => {
    if (snapshots.length === 0) return null;
    return [...snapshots].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;
  }, [snapshots]);

  const copyFromLatestSnapshot = useCallback(() => {
    const src = latestSnapshotForCopy;
    if (!src) return;
    if (src.firmware_version?.trim()) setAvFw(src.firmware_version.trim());
    if (src.software_version?.trim()) setAvSw(src.software_version.trim());
    if (src.config_version?.trim()) setAvCfg(src.config_version.trim());
  }, [latestSnapshotForCopy]);

  const onPromoteVersion = useCallback(
    async (s: DeviceVersionSnapshot) => {
      if (!deviceId) return;
      setLifecycleBusyId(s.id);
      try {
        const st = (s.status || "").toLowerCase();
        if (st === "detected") await submitDeviceVersionDraft(s.id);
        await promoteDeviceVersion(s.id);
        pushMessage("success", "Version promoted — this row becomes active; other versions are superseded for governance.");
        const d = await getDevice(deviceId);
        setDevice(d);
        const res = await listDeviceVersionSnapshots(deviceId);
        setSnapshots(res?.items ?? []);
      } catch (e) {
        pushMessage("error", isApiHttpError(e) ? e.message : "Promote failed");
      } finally {
        setLifecycleBusyId(null);
      }
    },
    [deviceId, pushMessage],
  );

  const onDeprecateVersion = useCallback(
    async (versionId: string) => {
      if (!deviceId) return;
      if (
        !window.confirm(
          "Deprecate this version permanently? This cannot be undone. The snapshot becomes read-only for operators.",
        )
      ) {
        return;
      }
      setLifecycleBusyId(versionId);
      try {
        await deprecateDeviceVersion(versionId);
        pushMessage("success", "Version deprecated.");
        const d = await getDevice(deviceId);
        setDevice(d);
        const res = await listDeviceVersionSnapshots(deviceId);
        setSnapshots(res?.items ?? []);
      } catch (e) {
        pushMessage("error", isApiHttpError(e) ? e.message : "Deprecate failed");
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

  const resetAddVersionFields = useCallback(() => {
    setAvLabel("");
    setAvNotes("");
    setAvSw("");
    setAvCfg("");
    setAvFw("");
  }, []);

  const openAddVersionForm = useCallback(() => {
    resetAddVersionFields();
    setAvFw(device?.firmware_version?.trim() ?? "");
    setAddVersionOpen(true);
  }, [device, resetAddVersionFields]);

  const onSubmitAddVersion = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!deviceId || !device) return;
      const label = avLabel.trim();
      if (!label) {
        pushMessage("error", "Enter a version label.");
        return;
      }
      setAddVersionBusy(true);
      try {
        await createManualDeviceVersionDraft(deviceId, {
          display_version_label: label,
          notes: avNotes.trim() || null,
          firmware_version: avFw.trim() || null,
          snapshot_software_version: avSw.trim() || null,
          snapshot_config_version: avCfg.trim() || null,
        });
        const fwOnly = avFw.trim();
        if (fwOnly) {
          await updateDevice(deviceId, { firmware_version: fwOnly });
        }
        const d = await getDevice(deviceId);
        setDevice(d);
        const res = await listDeviceVersionSnapshots(deviceId);
        setSnapshots(res?.items ?? []);
        pushMessage("success", `Draft version "${label}" created. Promote when ready to update the device’s current label.`);
        setAddVersionOpen(false);
        resetAddVersionFields();
      } catch (err) {
        pushMessage("error", isApiHttpError(err) ? err.message : "Could not add version");
      } finally {
        setAddVersionBusy(false);
      }
    },
    [deviceId, device, avLabel, avNotes, avFw, avSw, avCfg, pushMessage, resetAddVersionFields],
  );

  const onSaveTrafficSettings = useCallback(async () => {
    if (!deviceId || !device || !trafficDirty) return;
    setTrafficBusy(true);
    try {
      await updateDevice(deviceId, { is_active: trafficDeviceActive, version_status: trafficVersionStatus });
      const d = await getDevice(deviceId);
      setDevice(d);
      try {
        const fp = await getDeviceFootprint(deviceId);
        setFootprint(fp);
      } catch {
        setFootprint(null);
      }
      pushMessage("success", "Incoming data settings saved.");
    } catch (err) {
      pushMessage("error", isApiHttpError(err) ? err.message : "Could not save settings");
    } finally {
      setTrafficBusy(false);
    }
  }, [deviceId, device, trafficDirty, trafficDeviceActive, trafficVersionStatus, pushMessage]);

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
        title="Device Details"
        subtitle={device ? `${device.name} · ${device.id.slice(0, 8)}…` : undefined}
        size="lg"
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
                <p className="device-details-page__sub device-details-page__sub--compact">
                  Identity fields are edited on{" "}
                  <Link to="/devices/register">Manage Devices</Link>. <strong>Device status</strong> and{" "}
                  <strong>Data pipeline</strong> (raw + scrubbed ingest gates) are configured on the{" "}
                  <button type="button" className="device-details-page__tab-jump" onClick={() => setTab("ingest")}>
                    Ingest
                  </button>{" "}
                  tab.
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
                  {!canDeviceWrite ? (
                    <div className="device-details-page__card">
                      <div className="device-details-page__card-label">Version status</div>
                      <div className="device-details-page__card-value">
                        <span
                          className={`dm-version-pill dm-version-pill--status-${versionStatusPillSuffix(normalizeVersionStatus(device.version_status))}`}
                        >
                          {formatVersionStatusLabel(normalizeVersionStatus(device.version_status))}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <div className="device-details-page__card">
                    <div className="device-details-page__card-label">Device active</div>
                    <div className="device-details-page__card-value">{device.is_active !== false ? "Yes" : "No"}</div>
                  </div>
                  <div className="device-details-page__card">
                    <div className="device-details-page__card-label">Firmware rollout readiness</div>
                    <div className="device-details-page__card-value">
                      OTA-capable {device.ota_supported ? "yes" : "no"} · Rollback-capable {device.rollback_supported ? "yes" : "no"}
                    </div>
                  </div>
                  {footprint ? (
                    <div className="device-details-page__card device-details-page__card--span-full">
                      <div className="device-details-page__card-label">Operational footprint</div>
                      <div className="device-details-page__footprint-row">
                        <OpsStatusPill status={footprint.status} variant={footprintOperationalPillVariant(footprint.status)} />
                        <span className="device-details-page__footprint-msg">{footprint.recommendation.message}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
                {canDeviceWrite ? (
                  <p className="device-details-page__sub device-details-page__sub--compact" style={{ marginTop: "0.75rem" }}>
                    <button type="button" className="device-details-page__tab-jump" onClick={() => setTab("ingest")}>
                      Ingest
                    </button>{" "}
                    to change device active / version status for ingest.
                  </p>
                ) : null}
                {!footprint ? (
                  <p className="device-details-page__sub device-details-page__sub--compact">Footprint not available (check devices.footprint.read).</p>
                ) : null}
              </section>
            ) : null}

            {tab === "ingest" ? (
              <section className="device-details-page__section" aria-labelledby="dd-ingest-h">
                <h2 id="dd-ingest-h" className="dm-sr-only">
                  Ingest
                </h2>
                <p className="device-details-page__sub device-details-page__sub--compact">
                  <strong>Device status</strong> and <strong>Data pipeline</strong> map to <code>devices.is_active</code> and ingest-blocking{" "}
                  <code>version_status</code> (<strong>Deprecated</strong> / <strong>Rolled back</strong>). Same fields as Manage Devices / API.
                </p>
                <div className="device-details-page__ingest-panel" aria-labelledby="dd-ingest-panel-h">
                  <h3 id="dd-ingest-panel-h" className="device-details-page__card-label" style={{ marginBottom: "0.35rem" }}>
                    Device ingest
                  </h3>
                  <dl className="device-details-page__ingest-dl">
                    <div>
                      <dt>Device status</dt>
                      <dd>
                        <OpsStatusPill
                          status={deriveDeviceStatusLabel(device)}
                          variant={deriveDeviceStatusLabel(device) === "Active" ? "online" : "disabled"}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Data pipeline</dt>
                      <dd>
                        <OpsStatusPill
                          status={deriveDataPipelineLabel(device)}
                          variant={deriveDataPipelineLabel(device) === "Active" ? "online" : "disabled"}
                        />
                      </dd>
                    </div>
                  </dl>
                  {canDeviceWrite ? (
                    <>
                      <p className="device-details-page__sub device-details-page__sub--compact">
                        <strong>Inactive</strong> device stops new traffic. <strong>Data pipeline inactive</strong> when the device is inactive or
                        version status is <strong>Deprecated</strong> / <strong>Rolled back</strong> (stops new raw archive + scrubber for this device).
                      </p>
                      <div className="device-details-page__traffic-fields">
                        <label className="device-details-page__add-version-field device-details-page__add-version-field--full">
                          <span>Device status</span>
                          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <input
                              type="checkbox"
                              checked={trafficDeviceActive}
                              onChange={(e) => setTrafficDeviceActive(e.target.checked)}
                              aria-label="Device active"
                            />
                            <span style={{ fontWeight: 500, color: "var(--color-text)" }}>Active (accept traffic)</span>
                          </span>
                        </label>
                        <label className="device-details-page__add-version-field device-details-page__add-version-field--full">
                          <span>Version status (ingest)</span>
                          <select
                            value={trafficVersionStatus}
                            onChange={(e) => setTrafficVersionStatus(e.target.value)}
                            aria-label="Version status for ingest"
                          >
                            {DEVICE_VERSION_STATUS_UI_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="device-details-page__add-version-actions">
                          <AarButton type="button" variant="primary" disabled={trafficBusy || !trafficDirty} onClick={() => void onSaveTrafficSettings()}>
                            {trafficBusy ? "Saving…" : "Save ingest settings"}
                          </AarButton>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="device-details-page__sub device-details-page__sub--compact">You need <code>devices.write</code> to change ingest settings.</p>
                  )}
                </div>
              </section>
            ) : null}

            {tab === "versions" ? (
              <section className="device-details-page__section" aria-labelledby="dd-versions-h">
                <h2 id="dd-versions-h" className="dm-sr-only">
                  Versions
                </h2>
                <p className="device-details-page__sub device-details-page__sub--compact">
                  Immutable <code>device_versions</code> rows. Use <strong>Promote</strong> to make a version the active cut (superseding others for
                  governance). <strong>Deprecate</strong> is permanent and makes the snapshot read-only. <strong>Device status</strong> and{" "}
                  <strong>Data pipeline</strong> columns reflect current device ingest gates — edit them on the <strong>Ingest</strong> tab.
                </p>
                <div className="device-details-page__versions-toolbar">
                  {canDeviceWrite ? (
                    <>
                      {!addVersionOpen ? (
                        <AarButton type="button" variant="primary" onClick={openAddVersionForm}>
                          Add Version
                        </AarButton>
                      ) : (
                        <form className="device-details-page__add-version" onSubmit={onSubmitAddVersion}>
                          <div className="device-details-page__add-version-head">
                            <strong>Add Version</strong>
                            <span className="device-details-page__add-version-source">Source: manual</span>
                          </div>
                          <div className="device-details-page__add-version-grid">
                            <label className="device-details-page__add-version-field">
                              <span>Version label</span>
                              <input
                                value={avLabel}
                                onChange={(e) => setAvLabel(e.target.value)}
                                required
                                autoComplete="off"
                                placeholder={`e.g. next after ${device.device_version ?? "1"}`}
                              />
                            </label>
                            <label className="device-details-page__add-version-field device-details-page__add-version-field--full">
                              <span>Release notes</span>
                              <textarea value={avNotes} onChange={(e) => setAvNotes(e.target.value)} rows={2} placeholder="Optional" />
                            </label>
                            <label className="device-details-page__add-version-field">
                              <span>Firmware version</span>
                              <input
                                value={avFw}
                                onChange={(e) => setAvFw(e.target.value)}
                                placeholder="Updates declared firmware on the device (optional)"
                              />
                            </label>
                            <label className="device-details-page__add-version-field">
                              <span>Software version</span>
                              <input value={avSw} onChange={(e) => setAvSw(e.target.value)} placeholder="Stored on snapshot only (optional)" />
                            </label>
                            <label className="device-details-page__add-version-field">
                              <span>Config version</span>
                              <input value={avCfg} onChange={(e) => setAvCfg(e.target.value)} placeholder="Stored on snapshot only (optional)" />
                            </label>
                          </div>
                          <div className="device-details-page__add-version-actions">
                            <AarButton type="submit" variant="primary" disabled={addVersionBusy}>
                              {addVersionBusy ? "Saving…" : "Create version"}
                            </AarButton>
                            <AarButton
                              type="button"
                              variant="outline"
                              disabled={addVersionBusy || !latestSnapshotForCopy}
                              title={
                                latestSnapshotForCopy
                                  ? `Copy firmware, software, and config version from snapshot "${latestSnapshotForCopy.version_label}"`
                                  : "No snapshots yet"
                              }
                              onClick={copyFromLatestSnapshot}
                            >
                              Copy from latest snapshot
                            </AarButton>
                            <AarButton
                              type="button"
                              variant="outline"
                              disabled={addVersionBusy}
                              onClick={() => {
                                setAddVersionOpen(false);
                                resetAddVersionFields();
                              }}
                            >
                              Cancel
                            </AarButton>
                          </div>
                          <p className="device-details-page__add-version-hint">
                            Creates a <strong>draft</strong> governed row via{" "}
                            <code>{`POST /devices/{id}/versions`}</code> (<code>display_version_label</code>, optional notes
                            and snapshot fields). The device&apos;s current label updates when you <strong>promote</strong> that
                            draft. You can still change the label directly with <code>{`PATCH /devices/{id}`}</code> and{" "}
                            <code>device_version</code> for legacy flows. Readiness toggles and channel edits alone do not
                            create version rows; endpoint detection and ingest-shape cuts still create governed rows.
                          </p>
                        </form>
                      )}
                    </>
                  ) : device && permReady ? (
                    <p className="device-details-page__sub device-details-page__sub--compact" role="status">
                      You need <code>devices.write</code> to add a version from here.
                    </p>
                  ) : null}
                </div>
                {device && !canDeviceVersionsRead ? (
                  <p className="device-details-page__sub" role="status">
                    You need <code>device_versions.read</code> for this device&apos;s site to load snapshots.
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
                          <th className="dm-data-table__th dm-data-table__th--center">Device status</th>
                          <th className="dm-data-table__th dm-data-table__th--center">Data pipeline</th>
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
                            <td className="dm-data-table__td dm-data-table__td--center">
                              <OpsStatusPill
                                status={deriveDeviceStatusLabel(device)}
                                variant={deriveDeviceStatusLabel(device) === "Active" ? "online" : "disabled"}
                              />
                            </td>
                            <td className="dm-data-table__td dm-data-table__td--center">
                              <OpsStatusPill
                                status={deriveDataPipelineLabel(device)}
                                variant={deriveDataPipelineLabel(device) === "Active" ? "online" : "disabled"}
                              />
                            </td>
                            <td className="dm-data-table__td dm-data-table__td--actions">
                              <div className="device-details-page__version-actions-icons">
                                {(() => {
                                  const st = (s.status || "").toLowerCase();
                                  const promoteDisabled =
                                    lifecycleBusyId === s.id ||
                                    !canPromote ||
                                    st === "active" ||
                                    st === "deprecated" ||
                                    st === "rolled_back";
                                  const deprecateDisabled =
                                    lifecycleBusyId === s.id || !canDeprecate || st === "deprecated" || st === "rolled_back";
                                  return (
                                    <>
                                      <OpsActionButton
                                        tone="plain"
                                        title={
                                          st === "detected"
                                            ? "Promote — submit for review then activate this version"
                                            : "Promote — make this version the active cut (other versions are superseded)"
                                        }
                                        aria-label={`Promote version ${s.version_label}`}
                                        disabled={promoteDisabled}
                                        onClick={() => void onPromoteVersion(s)}
                                      >
                                        <CircleArrowUp size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                                      </OpsActionButton>
                                      <OpsActionButton
                                        tone="plain"
                                        title="Deprecate permanently — read-only snapshot (cannot undo)"
                                        aria-label={`Deprecate version ${s.version_label}`}
                                        disabled={deprecateDisabled}
                                        onClick={() => void onDeprecateVersion(s.id)}
                                      >
                                        <Ban size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                                      </OpsActionButton>
                                    </>
                                  );
                                })()}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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
