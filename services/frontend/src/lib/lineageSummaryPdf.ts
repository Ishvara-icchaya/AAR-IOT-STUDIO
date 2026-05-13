import { jsPDF } from "jspdf";

import type { DeviceFootprintRead, DeviceVersionLineageRead } from "@/api/devices";

/** Payload for PDF export / workspace send — one device footprint modal. */
export type DeviceFootprintPdfInput = {
  generatedAtIso: string;
  deviceName: string;
  siteName: string;
  deviceId: string;
  footprint: DeviceFootprintRead;
  lineage: DeviceVersionLineageRead | null;
};

function safeFilenamePart(name: string): string {
  return name
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 48) || "device";
}

export function footprintPdfFilename(deviceName: string): string {
  const d = new Date().toISOString().slice(0, 10);
  return `footprint-${safeFilenamePart(deviceName)}-${d}.pdf`;
}

export function buildDeviceFootprintSummaryPdfBlob(input: DeviceFootprintPdfInput): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  const maxW = pageW - margin * 2;
  let y = margin;

  const addLines = (text: string, lineHeight = 14) => {
    const lines = doc.splitTextToSize(text, maxW);
    for (const line of lines) {
      if (y > doc.internal.pageSize.getHeight() - 48) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += lineHeight;
    }
  };

  const fp = input.footprint;

  doc.setFontSize(16);
  addLines("Device operational footprint", 20);
  doc.setFontSize(10);
  addLines(`Generated: ${new Date(input.generatedAtIso).toLocaleString()}`);
  addLines(`Device: ${input.deviceName}`);
  addLines(`Site: ${input.siteName}`);
  addLines(`Device ID: ${input.deviceId}`);
  y += 6;
  doc.setFontSize(11);
  addLines("Summary", 16);
  doc.setFontSize(10);
  addLines(`Operational status: ${fp.status}`);
  addLines(`Recommendation: ${fp.recommendation.code} — ${fp.recommendation.message}`);
  addLines(`Activation: ${fp.device.activation_status ?? "—"}`);
  addLines(`Resolved device: ${fp.device.resolved_device_id ?? "—"}`);
  y += 8;
  doc.setFontSize(11);
  addLines("Pipeline snapshot", 16);
  doc.setFontSize(9);
  addLines(`Ingestion: ${JSON.stringify(fp.ingestion)}`);
  addLines(`Endpoint: ${fp.endpoint ? JSON.stringify(fp.endpoint) : "null"}`);
  addLines(`Scrubber: ${JSON.stringify(fp.scrubber)}`);
  addLines(`Workflow: ${JSON.stringify(fp.workflow)}`);
  addLines(`Dashboard: ${JSON.stringify(fp.dashboard)}`);
  addLines(`Trends: ${JSON.stringify(fp.trends)}`);
  y += 8;

  if (input.lineage?.versions?.length) {
    doc.setFontSize(11);
    addLines("Version lineage (API)", 16);
    doc.setFontSize(9);
    for (const v of input.lineage.versions) {
      addLines(
        `v${v.version_label}${v.is_current ? " (current)" : ""} · ${v.trigger_code}` +
          (v.recorded_at ? ` · ${v.recorded_at}` : "") +
          (v.superseded_by_label ? ` · superseded by v${v.superseded_by_label}` : ""),
      );
    }
    if (input.lineage.kpi_metric_keys.length) {
      y += 4;
      doc.setFontSize(10);
      addLines("KPI keys (footprint-derived): " + input.lineage.kpi_metric_keys.join(", "));
      for (const label of Object.keys(input.lineage.kpi_by_version)) {
        addLines(`  ${label}: ${JSON.stringify(input.lineage.kpi_by_version[label])}`);
      }
    }
    y += 6;
  }

  doc.setFontSize(11);
  addLines("Full footprint JSON", 16);
  doc.setFontSize(8);
  addLines(JSON.stringify(fp, null, 2), 11);

  return doc.output("blob");
}
