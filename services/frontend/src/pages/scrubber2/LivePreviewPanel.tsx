import { useMemo, useState } from "react";
import { getByPath } from "@/lib/scrubber2Fields";
import type { Scrubber2Model } from "@/types/scrubber2Model";

export type ScrubberPreviewBlock = {
  raw_object_id: string;
  device_id: string;
  preview: {
    object_name: string;
    output_payload: Record<string, unknown>;
    kpi: Record<string, unknown>;
    health_status: string;
    health_code: string;
    health_message: string;
    health_details?: Record<string, unknown> | null;
    ai_projection?: Record<string, unknown> | null;
  };
  error: string | null;
} | null;

type Tab = "payload" | "kpi" | "health" | "map";

type Props = {
  scrubPreview: ScrubberPreviewBlock;
  samplePayload: Record<string, unknown> | null;
  model: Scrubber2Model;
};

export function LivePreviewPanel({ scrubPreview, samplePayload, model }: Props) {
  const [tab, setTab] = useState<Tab>("payload");

  const mapPreview = useMemo(() => {
    if (!samplePayload) return null;
    const lat = model.location.latitudePath ? getByPath(samplePayload, model.location.latitudePath) : undefined;
    const lng = model.location.longitudePath ? getByPath(samplePayload, model.location.longitudePath) : undefined;
    const hdg = model.location.headingPath ? getByPath(samplePayload, model.location.headingPath) : undefined;
    return { lat, lng, hdg };
  }, [samplePayload, model.location]);

  const payloadJson = useMemo(() => {
    const p = scrubPreview?.preview?.output_payload;
    if (p && typeof p === "object") return JSON.stringify(p, null, 2);
    return "Run Validate to load server preview.";
  }, [scrubPreview]);

  const kpiJson = useMemo(() => {
    const k = scrubPreview?.preview?.kpi;
    if (k && typeof k === "object") return JSON.stringify(k, null, 2);
    return "—";
  }, [scrubPreview]);

  return (
    <div className="scrubber2-panel">
      <div className="scrubber2-panel__head">
        <h3 className="scrubber2-panel__title">Preview</h3>
        <span className="scrubber2-toolbar" style={{ gap: "0.35rem" }}>
          <span className="scrubber2-live-dot" />
          <span className="scrubber2-muted">Live</span>
        </span>
      </div>
      <div className="scrubber2-panel-body">
        <div className="scrubber2-tabs" role="tablist">
          {(
            [
              ["payload", "Payload"],
              ["kpi", "KPI output"],
              ["health", "Health"],
              ["map", "Map"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={`scrubber2-tab${tab === id ? " scrubber2-tab--on" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "payload" && (
          <div className="scrubber2-code-scroll">
            <pre>{payloadJson}</pre>
          </div>
        )}
        {tab === "kpi" && (
          <div className="scrubber2-code-scroll scrubber2-preview-kpi">
            <pre>{kpiJson}</pre>
          </div>
        )}
        {tab === "health" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.78rem" }}>
            <div>
              <span className="scrubber2-muted">Status </span>
              <strong className={scrubPreview?.preview?.health_status === "green" ? "scrubber2-good" : "scrubber2-warn"}>
                {scrubPreview?.preview?.health_status ?? "—"}
              </strong>
            </div>
            <div className="scrubber2-muted">Code: {scrubPreview?.preview?.health_code ?? "—"}</div>
            <div>{scrubPreview?.preview?.health_message ?? "—"}</div>
            {scrubPreview?.error ? <div className="scrubber2-bad">{scrubPreview.error}</div> : null}
          </div>
        )}
        {tab === "map" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.78rem" }}>
            <div>
              <span className="scrubber2-muted">Latitude </span>
              {mapPreview?.lat != null ? String(mapPreview.lat) : "—"}
            </div>
            <div>
              <span className="scrubber2-muted">Longitude </span>
              {mapPreview?.lng != null ? String(mapPreview.lng) : "—"}
            </div>
            <div>
              <span className="scrubber2-muted">Heading </span>
              {mapPreview?.hdg != null ? String(mapPreview.hdg) : "—"}
            </div>
            <div className="scrubber2-muted" style={{ marginTop: "0.35rem" }}>
              Map tile preview is omitted in v2 shell; coordinates update from field mapping + sample payload.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
