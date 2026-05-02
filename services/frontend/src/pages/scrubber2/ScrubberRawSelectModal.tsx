import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Eye } from "lucide-react";
import { jsPDF } from "jspdf";
import { apiFetch } from "@/api/client";
import { AppModalShell } from "@/components/app/AppModalShell";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { PageStatus } from "@/components/PageStatus";

import "./scrubber2.css";

type RawRow = {
  id: string;
  ingested_at: string;
  size_bytes: number | null;
  protocol_source: string | null;
};

type ListResp = { items: RawRow[]; total: number };

type RawPreview = {
  raw_object_id: string;
  offset: number;
  requested_max_bytes: number;
  total_size: number | null;
  returned_bytes: number;
  truncated: boolean;
  content_type: string | null;
  encoding: "utf8" | "base64";
  text: string | null;
  base64: string | null;
};

const PAGE_SIZE = 10;

type SortKey = "ingested_at" | "size_bytes";

function formatPayloadPreview(text: string, contentType: string | null): string {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("json") || (text.trim().startsWith("{") && text.trim().endsWith("}"))) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* keep raw */
    }
  }
  return text;
}

function payloadTextFromPreview(p: RawPreview | null): string {
  if (!p) return "";
  if (p.encoding === "utf8" && p.text != null) {
    return formatPayloadPreview(p.text, p.content_type);
  }
  if (p.encoding === "base64" && p.base64) {
    return `[binary base64, ${p.base64.length} chars]\n${p.base64.slice(0, 12_000)}${p.base64.length > 12_000 ? "…" : ""}`;
  }
  return "—";
}

function buildExportDocument(meta: {
  deviceName: string;
  rawId: string;
  protocol: string;
  ingested: string;
  payload: string;
}) {
  return [
    `Device name: ${meta.deviceName}`,
    `Raw ID: ${meta.rawId}`,
    `Protocol: ${meta.protocol}`,
    `Ingested: ${meta.ingested}`,
    "",
    "Payload:",
    "—".repeat(40),
    meta.payload,
  ].join("\n");
}

function downloadTxt(filename: string, text: string) {
  const blob = new Blob([`\uFEFF${text}`], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadPdf(meta: {
  deviceName: string;
  rawId: string;
  protocol: string;
  ingested: string;
  payload: string;
}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 12;
  let y = margin;
  const pageBottom = 285;
  const lineH = 4.5;
  const maxW = 186;

  const addLines = (text: string, size = 9, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const parts = doc.splitTextToSize(text, maxW);
    for (const part of parts) {
      if (y > pageBottom) {
        doc.addPage();
        y = margin;
      }
      doc.text(part, margin, y);
      y += lineH;
    }
  };

  addLines("Raw archive export", 12, true);
  y += 2;
  addLines(
    [
      `Device name: ${meta.deviceName}`,
      `Raw ID: ${meta.rawId}`,
      `Protocol: ${meta.protocol}`,
      `Ingested: ${meta.ingested}`,
      "",
      "Payload:",
    ].join("\n"),
  );
  y += 2;
  addLines(meta.payload || "(empty)");

  doc.save(`raw-${meta.rawId.slice(0, 8)}.pdf`);
}

function csvEscape(v: string) {
  return `"${v.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows: RawRow[]) {
  const header = ["raw_id", "ingested_at", "size_bytes", "protocol_source"].join(",");
  const body = rows.map((r) =>
    [csvEscape(r.id), csvEscape(r.ingested_at), String(r.size_bytes ?? ""), csvEscape(String(r.protocol_source ?? ""))].join(
      ",",
    ),
  );
  return `\uFEFF${[header, ...body].join("\n")}`;
}

function sortRows(rows: RawRow[], sortKey: SortKey, sortDir: "asc" | "desc"): RawRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sortKey === "ingested_at") {
      const ta = new Date(a.ingested_at).getTime();
      const tb = new Date(b.ingested_at).getTime();
      const cmp = ta - tb;
      return sortDir === "asc" ? cmp : -cmp;
    }
    const sa = a.size_bytes ?? -1;
    const sb = b.size_bytes ?? -1;
    const cmp = sa - sb;
    return sortDir === "asc" ? cmp : -cmp;
  });
  return copy;
}

export type ScrubberRawSelectModalProps = {
  open: boolean;
  onClose: () => void;
  /** Device context for this view (no picker — fixed to the current pipeline or URL). */
  deviceId: string;
  deviceName: string;
};

export function ScrubberRawSelectModal({ open, onClose, deviceId, deviceName }: ScrubberRawSelectModalProps) {
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("ingested_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<RawRow | null>(null);
  const [preview, setPreview] = useState<RawPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const selectedRow = useMemo(() => rows.find((r) => r.id === selectedId) ?? selectedSnapshot, [rows, selectedId, selectedSnapshot]);

  const sortedRows = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }, [sortKey]);

  const loadPage = useCallback(async () => {
    if (!open || !deviceId.trim()) return;
    setListErr(null);
    setListLoading(true);
    try {
      const offset = (page - 1) * PAGE_SIZE;
      const qs = new URLSearchParams({
        device_id: deviceId.trim(),
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const data = await apiFetch<ListResp>(`/raw-data-objects?${qs.toString()}`);
      setRows(data?.items ?? []);
      setTotal(data?.total ?? 0);
    } catch (e2) {
      setListErr(e2 instanceof Error ? e2.message : "Failed raw list");
      setRows([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }, [open, deviceId, page]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (!open) return;
    setPage(1);
    setSelectedId(null);
    setSelectedSnapshot(null);
    setPreview(null);
    setPreviewErr(null);
  }, [open, deviceId]);

  useEffect(() => {
    if (!selectedId || !open) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewErr(null);
    setPreview(null);
    void (async () => {
      try {
        const prev = await apiFetch<RawPreview>(
          `/raw-data-objects/${encodeURIComponent(selectedId)}/preview?max_bytes=262144`,
        );
        if (!cancelled) setPreview(prev ?? null);
      } catch (e) {
        if (!cancelled) setPreviewErr(e instanceof Error ? e.message : "Failed to load payload");
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, open]);

  function exportCsv() {
    if (!sortedRows.length) return;
    const csv = rowsToCsv(sortedRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `raw-samples-${deviceName.replace(/[^\w\-]+/g, "_")}-page${page}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportDownloads() {
    if (!selectedId || !selectedRow) return;
    const payload = previewLoading ? "" : payloadTextFromPreview(preview);
    return {
      deviceName,
      rawId: selectedId,
      protocol: String(selectedRow.protocol_source ?? "—"),
      ingested: new Date(selectedRow.ingested_at).toLocaleString(),
      payload,
    };
  }

  const sortIndicator = (active: boolean, dir: "asc" | "desc"): ReactNode =>
    active ? dir === "asc" ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden /> : null;

  const columns = useMemo<PlainOperationalColumn<RawRow>[]>(() => {
    return [
      {
        id: "id",
        header: "Raw ID",
        cell: (r) => <code style={{ fontSize: "0.75rem" }}>{r.id}</code>,
      },
      {
        id: "ingested_at",
        header: (
          <button
            type="button"
            className="scrubber-raw-sort-th"
            onClick={() => toggleSort("ingested_at")}
            aria-label={`Sort by ingested, ${sortKey === "ingested_at" ? sortDir : "default"}`}
          >
            Ingested
            {sortIndicator(sortKey === "ingested_at", sortDir)}
          </button>
        ),
        cell: (r) => new Date(r.ingested_at).toLocaleString(),
      },
      {
        id: "size_bytes",
        header: (
          <button
            type="button"
            className="scrubber-raw-sort-th"
            onClick={() => toggleSort("size_bytes")}
            aria-label={`Sort by size, ${sortKey === "size_bytes" ? sortDir : "default"}`}
          >
            Size
            {sortIndicator(sortKey === "size_bytes", sortDir)}
          </button>
        ),
        cell: (r) => String(r.size_bytes ?? "—"),
      },
      {
        id: "protocol_source",
        header: "Protocol",
        cell: (r) => String(r.protocol_source ?? "—"),
      },
      {
        id: "view",
        header: "",
        align: "center",
        cell: (r) => (
          <button
            type="button"
            className="scrubber2-btn scrubber2-btn--ghost"
            title="View payload"
            aria-label="View payload"
            aria-pressed={selectedId === r.id}
            onClick={() => {
              setSelectedId(r.id);
              setSelectedSnapshot(r);
            }}
          >
            <Eye size={18} strokeWidth={2} aria-hidden />
          </button>
        ),
      },
    ];
  }, [selectedId, sortKey, sortDir, toggleSort]);

  const previewBody = previewLoading ? "Loading…" : previewErr ? previewErr : payloadTextFromPreview(preview);

  const subtitle = deviceName.trim()
    ? `${deviceName} — archived raw payloads (read-only).`
    : "Archived payloads are read-only.";

  if (!deviceId.trim()) {
    return (
      <AppModalShell
        open={open}
        onClose={onClose}
        title="Raw sample"
        subtitle="Select a device in the pipeline editor first."
        titleId="scrubber-raw-select-modal-title"
        size="xl"
        dialogClassName="scrubber-raw-select-modal"
      >
        <p className="scrubber2-muted" style={{ margin: 0, fontSize: "0.85rem" }}>
          No device is selected for this context.
        </p>
      </AppModalShell>
    );
  }

  return (
    <AppModalShell
      open={open}
      onClose={onClose}
      title="Raw sample"
      subtitle={subtitle}
      titleId="scrubber-raw-select-modal-title"
      size="xl"
      dialogClassName="scrubber-raw-select-modal"
    >
      <div className="scrubber-raw-select-modal__body">
        <div className="scrubber2-toolbar" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <button type="button" className="scrubber2-btn scrubber2-btn--ghost" disabled={listLoading} onClick={() => void loadPage()}>
            Refresh list
          </button>
          <button
            type="button"
            className="scrubber2-btn scrubber2-btn--ghost"
            disabled={!sortedRows.length}
            onClick={exportCsv}
          >
            Export page (CSV)
          </button>
        </div>

        {listErr ? <PageStatus variant="error">{listErr}</PageStatus> : null}

        <div className="scrubber-raw-select-modal__table">
          <PlainOperationalTable<RawRow>
            rows={sortedRows}
            columns={columns}
            getRowId={(r) => r.id}
            bordered
            pagination={false}
            loading={listLoading}
            innerScroll={false}
            emptyMessage="No raw objects for this device."
            resetPageKey={`${deviceId}|${page}`}
          />
        </div>

        <div className="scrubber2-toolbar" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <span className="scrubber2-muted" style={{ fontSize: "0.78rem" }}>
            Page {page} of {totalPages} ({total} total) · {PAGE_SIZE} per page
          </span>
          <span style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="scrubber2-btn scrubber2-btn--ghost"
              disabled={page <= 1 || listLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="scrubber2-btn scrubber2-btn--ghost"
              disabled={page >= totalPages || listLoading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </span>
        </div>

        <div className="scrubber2-panel scrubber-raw-select-modal__preview">
          <div className="scrubber2-panel__head">
            <h3 className="scrubber2-panel__title">Payload preview</h3>
            {selectedId ? (
              <span className="scrubber2-toolbar" style={{ gap: "0.35rem" }}>
                <button
                  type="button"
                  className="scrubber2-btn scrubber2-btn--ghost"
                  disabled={previewLoading || !selectedRow}
                  onClick={() => {
                    const m = exportDownloads();
                    if (m) downloadTxt(`raw-${m.rawId.slice(0, 8)}.txt`, buildExportDocument(m));
                  }}
                >
                  Download .txt
                </button>
                <button
                  type="button"
                  className="scrubber2-btn scrubber2-btn--ghost"
                  disabled={previewLoading || !selectedRow}
                  onClick={() => {
                    const m = exportDownloads();
                    if (m) downloadPdf(m);
                  }}
                >
                  Download .pdf
                </button>
              </span>
            ) : null}
          </div>
          <div className="scrubber2-panel-body" style={{ paddingTop: 0 }}>
            {!selectedId ? (
              <p className="scrubber2-muted" style={{ margin: 0, fontSize: "0.82rem" }}>
                Select a row and click the eye icon to load a payload preview.
              </p>
            ) : previewErr ? (
              <PageStatus variant="error">{previewErr}</PageStatus>
            ) : (
              <>
                {preview?.truncated ? (
                  <p className="scrubber2-muted" style={{ fontSize: "0.72rem", marginBottom: "0.35rem" }}>
                    Showing first {preview.returned_bytes} of {preview.total_size ?? "?"} bytes (truncated).
                  </p>
                ) : null}
                <pre className="scrubber-raw-select-modal__pre">{previewBody}</pre>
              </>
            )}
          </div>
        </div>
      </div>
    </AppModalShell>
  );
}
