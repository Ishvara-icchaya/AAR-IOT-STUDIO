import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { GitBranch, GitCompare, PlayCircle, Undo2, X } from "lucide-react";

import {
  deviceLineageFootprintUrl,
  getDeviceVersionLineage,
  type DeviceRead,
  type DeviceVersionLineageRead,
  type DeviceVersionLineageVersion,
} from "@/api/devices";
import { isApiHttpError } from "@/api/client";
import { AarButton } from "@/components/system/AarButton";
import { OpsStatusPill } from "@/components/ops/OpsStatusPill";
import {
  formatFirmwareChannelLabel,
  formatVersionStatusLabel,
  firmwareChannelPillSuffix,
  normalizeFirmwareChannel,
  normalizeVersionStatus,
  versionStatusPillSuffix,
} from "@/lib/deviceVersionUi";
import { ICON_SIZES, ICON_STROKE_WIDTH } from "@/lib/appIcons";

import "@/components/app/app-modal.css";
import "@/pages/device-register-page.css";

const Z_BACKDROP = 12000;
const Z_PANEL = 12001;

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  zIndex: Z_BACKDROP,
  border: "none",
  padding: 0,
  cursor: "pointer",
};

const panelStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  height: "100vh",
  maxWidth: "100%",
  width: "min(100vw - 12px, 480px)",
  zIndex: Z_PANEL,
  display: "flex",
  flexDirection: "column",
  animation: "ops-drawer-in 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="device-version-drawer__section">
      <h3 className="device-version-drawer__section-title">{title}</h3>
      {children}
    </section>
  );
}

function BevelPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`device-version-drawer__panel ${className}`.trim()}>{children}</div>;
}

function triggerLabel(code: string): string {
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

export function DeviceVersionHistoryDrawer({
  open,
  device,
  siteName,
  onClose,
}: {
  open: boolean;
  device: DeviceRead | null;
  siteName: string;
  onClose: () => void;
}) {
  const [lineage, setLineage] = useState<DeviceVersionLineageRead | null>(null);
  const [lineageErr, setLineageErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !device) {
      setLineage(null);
      setLineageErr(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await getDeviceVersionLineage(device.id);
        if (!cancelled) {
          setLineage(data);
          setLineageErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setLineage(null);
          setLineageErr(isApiHttpError(e) ? e.message : e instanceof Error ? e.message : "Could not load version lineage");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, device?.id]);

  const lineageCompareParams = useMemo(() => {
    if (!device) return { compareA: "none" as const, compareB: "1" };
    const labels = lineage?.versions?.map((v) => v.version_label) ?? [];
    const cur = device.device_version?.trim() || labels[labels.length - 1] || "1";
    const prev = labels.length > 1 ? labels[labels.length - 2]! : "none";
    return { compareA: prev, compareB: labels.length ? labels[labels.length - 1]! : cur };
  }, [lineage, device]);

  if (!open || !device || typeof document === "undefined") return null;

  const ch = normalizeFirmwareChannel(device.firmware_channel);
  const st = normalizeVersionStatus(device.version_status);
  const fw = device.firmware_version?.trim() || null;

  const timelineVersions: DeviceVersionLineageVersion[] =
    lineage?.versions?.length ?
      lineage.versions
    : [
        {
          id: `${device.id}:local`,
          version_label: device.device_version?.trim() || "1",
          is_current: true,
          recorded_at: null,
          trigger_code: "bootstrap",
          superseded_by_label: null,
          metadata: {},
        },
      ];

  return createPortal(
    <>
      <button type="button" aria-label="Close panel" style={backdropStyle} onClick={onClose} />
      <aside
        className="device-version-history-drawer device-version-drawer"
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-version-drawer-title"
      >
        <header className="device-version-drawer__head">
          <div className="device-version-drawer__head-text">
            <h2 id="device-version-drawer-title" className="device-version-drawer__title">
              Version history
            </h2>
            <p className="device-version-drawer__subtitle">
              {device.name} · {siteName}
            </p>
          </div>
          <button type="button" className="app-modal__close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </header>

        <div className="device-version-drawer__body">
          <Section title="Current version metadata">
            <BevelPanel>
              <dl className="device-version-drawer__meta">
                <div className="device-version-drawer__meta-row">
                  <dt>Device version</dt>
                  <dd>{device.device_version ?? "1"}</dd>
                </div>
                <div className="device-version-drawer__meta-row">
                  <dt>Version status</dt>
                  <dd>
                    <span className={`dm-version-pill dm-version-pill--status-${versionStatusPillSuffix(st)}`}>
                      {formatVersionStatusLabel(st)}
                    </span>
                  </dd>
                </div>
                <div className="device-version-drawer__meta-row">
                  <dt>Firmware version</dt>
                  <dd>{fw ?? "—"}</dd>
                </div>
                <div className="device-version-drawer__meta-row">
                  <dt>Firmware channel</dt>
                  <dd>
                    <span className={`dm-version-pill dm-version-pill--channel-${firmwareChannelPillSuffix(ch)}`}>
                      {formatFirmwareChannelLabel(ch)}
                    </span>
                  </dd>
                </div>
                <div className="device-version-drawer__meta-row">
                  <dt>OTA supported</dt>
                  <dd>{device.ota_supported ? "Yes" : "No"}</dd>
                </div>
                <div className="device-version-drawer__meta-row">
                  <dt>Rollback supported</dt>
                  <dd>{device.rollback_supported ? "Yes" : "No"}</dd>
                </div>
              </dl>
            </BevelPanel>
          </Section>

          <Section title="Version timeline">
            <BevelPanel>
              {lineageErr ? <p className="device-version-drawer__placeholder">{lineageErr}</p> : null}
              {!lineageErr ? (
                <ul className="device-version-drawer__timeline">
                  {timelineVersions.map((v) => (
                    <li key={v.id} className="device-version-drawer__timeline-item">
                      <span className="device-version-drawer__timeline-dot" aria-hidden />
                      <div>
                        <div className="device-version-drawer__timeline-label">
                          v{v.version_label}
                          {v.is_current ? " · current" : ""}
                        </div>
                        <p className="device-version-drawer__timeline-note">
                          {triggerLabel(v.trigger_code)}
                          {v.recorded_at ? ` · ${new Date(v.recorded_at).toLocaleString()}` : ""}
                          {v.superseded_by_label ? ` · superseded by v${v.superseded_by_label}` : ""}
                          {v.ota_external_ref ? ` · OTA ref: ${v.ota_external_ref}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!lineageErr && (!lineage || lineage.versions.length <= 1) ? (
                <p className="device-version-drawer__timeline-footnote">
                  Additional cuts appear when <strong>device_version</strong> changes (explicit PATCH) or future ingest /
                  OTA triggers record new rows.
                </p>
              ) : null}
            </BevelPanel>
          </Section>

          <Section title="Compatibility status">
            <BevelPanel>
              <p className="device-version-drawer__placeholder">Not evaluated yet.</p>
            </BevelPanel>
          </Section>

          <Section title="Last simulation result">
            <BevelPanel>
              <p className="device-version-drawer__placeholder">—</p>
            </BevelPanel>
          </Section>

          <Section title="OTA campaign history">
            <BevelPanel>
              <p className="device-version-drawer__placeholder">No campaigns recorded.</p>
            </BevelPanel>
          </Section>
        </div>

        <footer className="device-version-drawer__foot">
          <Link
            className="aar-btn aar-btn--outline dm-btn dm-btn--outline device-version-drawer__foot-link"
            to={deviceLineageFootprintUrl(device.id, {
              kpiAnchor: true,
              compareA: lineageCompareParams.compareA,
              compareB: lineageCompareParams.compareB,
            })}
            onClick={onClose}
          >
            <GitCompare size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
            Compare KPIs
          </Link>
          <AarButton type="button" variant="outline" disabled title="Coming soon">
            <PlayCircle size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
            Run simulation
          </AarButton>
          <Link
            className="aar-btn aar-btn--outline dm-btn dm-btn--outline device-version-drawer__foot-link"
            to={deviceLineageFootprintUrl(device.id)}
            onClick={onClose}
          >
            <GitBranch size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
            View lineage
          </Link>
          <AarButton type="button" variant="outline" disabled title="Coming soon">
            <Undo2 size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
            Rollback
          </AarButton>
        </footer>
      </aside>
    </>,
    document.body,
  );
}

/** Compact yes/no pill for OTA / rollback columns */
export function DeviceBoolPill({ value, trueLabel = "Yes", falseLabel = "No" }: { value: boolean; trueLabel?: string; falseLabel?: string }) {
  return <OpsStatusPill status={value ? trueLabel : falseLabel} variant={value ? "online" : "muted"} />;
}
