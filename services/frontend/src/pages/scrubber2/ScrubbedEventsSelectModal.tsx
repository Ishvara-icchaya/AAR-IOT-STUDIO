import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Eye } from "lucide-react";
import { jsPDF } from "jspdf";
import { listEndpointScrubbedEvents, type ScrubbedEventRead } from "@/api/scrubbedEvents";
import { AppModalShell } from "@/components/app/AppModalShell";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { PageStatus } from "@/components/PageStatus";

import "./scrubber2.css";

const PAGE_SIZE = 10;

type PageBlock = { items: ScrubbedEventRead[]; nextCursor: string | null };

type SortKey = "event_ts" | "ingested_at" | "object_name";

function truncateJson(obj: unknown, max: number): string {
  try {
    const s = JSON.stringify(obj);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return "—";
  }
}

export function scrubbedEventPayloadText(ev: ScrubbedEventRead): string {
  const merged = {
    id: ev.id,
    endpoint_id: ev.endpoint_id,
    resolved_device_id: ev.resolved_device_id,
    object_name: ev.object_name,
    event_ts: ev.event_ts,
    ingested_at: ev.ingested_at,
    identity_json: ev.identity_json,
    display_json: ev.display_json,
    kpi_json: ev.kpi_json,
    health_json: ev.health_json,
    location_json: ev.location_json,
    payload_ref: ev.payload_ref,
  };
  return JSON.stringify(merged, null, 2);
}

function buildExportDocument(meta: { deviceName: string; eventId: string; objectName: string; eventTs: string; payload: string }) {
  return [
    `Device name: ${meta.deviceName}`,
    `Scrubbed event ID: ${meta.eventId}`,
    `Object: ${meta.objectName}`,
    `Event time: ${meta.eventTs}`,
    "",
    "Payload (merged JSON columns):",
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

function downloadPdf(meta: { deviceName: string; eventId: string; objectName: string; eventTs: string; payload: string }) {
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

  addLines("Scrubbed event export", 12, true);
  y += 2;
  addLines(
    [
      `Device name: ${meta.deviceName}`,
      `Scrubbed event ID: ${meta.eventId}`,
      `Object: ${meta.objectName}`,
      `Event time: ${meta.eventTs}`,
      "",
      "Payload:",
    ].join("\n"),
  );
  y += 2;
  addLines(meta.payload || "(empty)");

  doc.save(`scrubbed-${meta.eventId.slice(0, 8)}.pdf`);
}

function csvEscape(v: string) {
  return `"${v.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows: ScrubbedEventRead[]) {
  const header = [
    "id",
    "event_ts",
    "ingested_at",
    "object_name",
    "identity_json",
    "display_json",
    "kpi_json",
    "health_json",
    "location_json",
    "payload_ref",
  ].join(",");
  const body = rows.map((r) =>
    [
      csvEscape(r.id),
      csvEscape(r.event_ts),
      csvEscape(r.ingested_at),
      csvEscape(r.object_name),
      csvEscape(JSON.stringify(r.identity_json)),
      csvEscape(JSON.stringify(r.display_json)),
      csvEscape(JSON.stringify(r.kpi_json)),
      csvEscape(JSON.stringify(r.health_json ?? null)),
      csvEscape(JSON.stringify(r.location_json ?? null)),
      csvEscape(String(r.payload_ref ?? "")),
    ].join(","),
  );
  return `\uFEFF${[header, ...body].join("\n")}`;
}

function sortRows(rows: ScrubbedEventRead[], sortKey: SortKey, sortDir: "asc" | "desc"): ScrubbedEventRead[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sortKey === "object_name") {
      const cmp = a.object_name.localeCompare(b.object_name);
      return sortDir === "asc" ? cmp : -cmp;
    }
    const key = sortKey === "event_ts" ? "event_ts" : "ingested_at";
    const ta = new Date(a[key]).getTime();
    const tb = new Date(b[key]).getTime();
    const cmp = ta - tb;
    return sortDir === "asc" ? cmp : -cmp;
  });
  return copy;
}

export type ScrubbedEventsSelectModalProps = {
  open: boolean;
  onClose: () => void;
  endpointId: string;
  deviceName: string;
  /** If set when the modal opens, selects this row when it appears on the first loaded page. */
  initialSelectedEventId?: string | null;
};

export function ScrubbedEventsSelectModal({
  open,
  onClose,
  endpointId,
  deviceName,
  initialSelectedEventId = null,
}: ScrubbedEventsSelectModalProps) {
  const [pages, setPages] = useState<PageBlock[]>([]);
  const [pageIdx, setPageIdx] = useState(0);
  const [listErr, setListErr] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>("event_ts");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<ScrubbedEventRead | null>(null);

  const currentRows = pages[pageIdx]?.items ?? [];
  const selectedRow = useMemo(
    () => currentRows.find((r) => r.id === selectedId) ?? selectedSnapshot,
    [currentRows, selectedId, selectedSnapshot],
  );

  const sortedRows = useMemo(() => sortRows(currentRows, sortKey, sortDir), [currentRows, sortKey, sortDir]);

  const canPrev = pageIdx > 0;
  const nextCursor = pages[pageIdx]?.nextCursor ?? null;
  const canNext = pageIdx + 1 < pages.length || Boolean(nextCursor);

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }, [sortKey]);

  useEffect(() => {
    if (!open) {
      setPages([]);
      setPageIdx(0);
      setSelectedId(null);
      setSelectedSnapshot(null);
      setListErr(null);
      setListLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !endpointId.trim()) return;
    const pickId = initialSelectedEventId?.trim() || null;
    setPages([]);
    setPageIdx(0);
    setSelectedId(null);
    setSelectedSnapshot(null);
    setListErr(null);
    setListLoading(true);
    void (async () => {
      try {
        const data = await listEndpointScrubbedEvents(endpointId, { limit: PAGE_SIZE });
        const block: PageBlock = { items: data.items ?? [], nextCursor: data.next_cursor ?? null };
        setPages([block]);
        if (pickId) {
          const hit = block.items.find((r) => r.id === pickId);
          if (hit) {
            setSelectedId(hit.id);
            setSelectedSnapshot(hit);
          }
        }
      } catch (e2) {
        setListErr(e2 instanceof Error ? e2.message : "Failed scrubbed list");
        setPages([]);
      } finally {
        setListLoading(false);
      }
    })();
  }, [open, endpointId, initialSelectedEventId]);

  const goPrev = useCallback(() => {
    setPageIdx((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(async () => {
    if (pageIdx + 1 < pages.length) {
      setPageIdx((i) => i + 1);
      return;
    }
    const cur = pages[pageIdx];
    if (!cur?.nextCursor) return;
    setListLoading(true);
    setListErr(null);
    try {
      const data = await listEndpointScrubbedEvents(endpointId, { limit: PAGE_SIZE, cursor: cur.nextCursor });
      const block: PageBlock = { items: data.items ?? [], nextCursor: data.next_cursor ?? null };
      setPages((p) => [...p, block]);
      setPageIdx((i) => i + 1);
    } catch (e2) {
      setListErr(e2 instanceof Error ? e2.message : "Failed next page");
    } finally {
      setListLoading(false);
    }
  }, [endpointId, pageIdx, pages]);

  function exportCsv() {
    if (!sortedRows.length) return;
    const csv = rowsToCsv(sortedRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `scrubbed-events-${deviceName.replace(/[^\w\-]+/g, "_")}-p${pageIdx + 1}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const previewBody = selectedRow ? scrubbedEventPayloadText(selectedRow) : "";

  const subtitle = deviceName.trim()
    ? `${deviceName} — scrubbed events for this endpoint (read-only).`
    : "Scrubbed events are read-only.";

  const sortIndicator = (active: boolean, dir: "asc" | "desc"): ReactNode =>
    active ? dir === "asc" ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden /> : null;

  const columns = useMemo<PlainOperationalColumn<ScrubbedEventRead>[]>(() => {
    return [
      {
        id: "id",
        header: "Event ID",
        cell: (r) => <code style={{ fontSize: "0.72rem" }}>{r.id}</code>,
      },
      {
        id: "event_ts",
        header: (
          <button
            type="button"
            className="scrubber-raw-sort-th"
            onClick={() => toggleSort("event_ts")}
            aria-label={`Sort by event time, ${sortKey === "event_ts" ? sortDir : "default"}`}
          >
            Event time
            {sortIndicator(sortKey === "event_ts", sortDir)}
          </button>
        ),
        cell: (r) => new Date(r.event_ts).toLocaleString(),
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
        id: "object_name",
        header: (
          <button
            type="button"
            className="scrubber-raw-sort-th"
            onClick={() => toggleSort("object_name")}
            aria-label={`Sort by object, ${sortKey === "object_name" ? sortDir : "default"}`}
          >
            Object
            {sortIndicator(sortKey === "object_name", sortDir)}
          </button>
        ),
        cell: (r) => r.object_name,
      },
      {
        id: "identity_json",
        header: "identity_json",
        cell: (r) => <code className="scrubber2-muted" style={{ fontSize: "0.7rem", whiteSpace: "pre-wrap" }}>{truncateJson(r.identity_json, 120)}</code>,
      },
      {
        id: "display_json",
        header: "display_json",
        cell: (r) => <code className="scrubber2-muted" style={{ fontSize: "0.7rem", whiteSpace: "pre-wrap" }}>{truncateJson(r.display_json, 120)}</code>,
      },
      {
        id: "kpi_json",
        header: "kpi_json",
        cell: (r) => <code className="scrubber2-muted" style={{ fontSize: "0.7rem", whiteSpace: "pre-wrap" }}>{truncateJson(r.kpi_json, 120)}</code>,
      },
      {
        id: "health_json",
        header: "health_json",
        cell: (r) => (
          <code className="scrubber2-muted" style={{ fontSize: "0.7rem", whiteSpace: "pre-wrap" }}>
            {r.health_json == null ? "—" : truncateJson(r.health_json, 80)}
          </code>
        ),
      },
      {
        id: "location_json",
        header: "location_json",
        cell: (r) => (
          <code className="scrubber2-muted" style={{ fontSize: "0.7rem", whiteSpace: "pre-wrap" }}>
            {r.location_json == null ? "—" : truncateJson(r.location_json, 80)}
          </code>
        ),
      },
      {
        id: "payload_ref",
        header: "payload_ref",
        cell: (r) => <span style={{ fontSize: "0.72rem", wordBreak: "break-all" }}>{r.payload_ref ?? "—"}</span>,
      },
      {
        id: "view",
        header: "",
        align: "center",
        cell: (r) => (
          <button
            type="button"
            className="scrubber2-btn scrubber2-btn--ghost"
            title="View merged payload sample"
            aria-label="View merged payload sample"
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

  const reloadFirst = useCallback(async () => {
    if (!endpointId.trim()) return;
    setListErr(null);
    setListLoading(true);
    try {
      const data = await listEndpointScrubbedEvents(endpointId, { limit: PAGE_SIZE });
      setPages([{ items: data.items ?? [], nextCursor: data.next_cursor ?? null }]);
      setPageIdx(0);
      setSelectedId(null);
      setSelectedSnapshot(null);
    } catch (e2) {
      setListErr(e2 instanceof Error ? e2.message : "Failed scrubbed list");
      setPages([]);
    } finally {
      setListLoading(false);
    }
  }, [endpointId]);

  if (!endpointId.trim()) {
    return (
      <AppModalShell
        open={open}
        onClose={onClose}
        title="Scrubbed event sample"
        subtitle="Select a device with an endpoint first."
        titleId="scrubbed-events-select-modal-title"
        size="xl"
        dialogClassName="scrubber-raw-select-modal"
      >
        <p className="scrubber2-muted" style={{ margin: 0, fontSize: "0.85rem" }}>
          No endpoint is selected for this context.
        </p>
      </AppModalShell>
    );
  }

  return (
    <AppModalShell
      open={open}
      onClose={onClose}
      title="Scrubbed event sample"
      subtitle={subtitle}
      titleId="scrubbed-events-select-modal-title"
      size="xl"
      dialogClassName="scrubber-raw-select-modal"
    >
      <div className="scrubber-raw-select-modal__body">
        <div className="scrubber2-toolbar" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <button type="button" className="scrubber2-btn scrubber2-btn--ghost" disabled={listLoading} onClick={() => void reloadFirst()}>
            Refresh list
          </button>
          <button type="button" className="scrubber2-btn scrubber2-btn--ghost" disabled={!sortedRows.length} onClick={exportCsv}>
            Export page (CSV)
          </button>
        </div>

        {listErr ? <PageStatus variant="error">{listErr}</PageStatus> : null}

        <div className="scrubber-raw-select-modal__table">
          <PlainOperationalTable<ScrubbedEventRead>
            rows={sortedRows}
            columns={columns}
            getRowId={(r) => r.id}
            bordered
            pagination={false}
            loading={listLoading}
            innerScroll={false}
            emptyMessage="No scrubbed events for this endpoint."
            resetPageKey={`${endpointId}|${pageIdx}|${open}`}
          />
        </div>

        <div className="scrubber2-toolbar" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <span className="scrubber2-muted" style={{ fontSize: "0.78rem" }}>
            Page {pageIdx + 1} · {PAGE_SIZE} per page (cursor pagination)
          </span>
          <span style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            <button type="button" className="scrubber2-btn scrubber2-btn--ghost" disabled={!canPrev || listLoading} onClick={goPrev}>
              Previous
            </button>
            <button type="button" className="scrubber2-btn scrubber2-btn--ghost" disabled={!canNext || listLoading} onClick={() => void goNext()}>
              Next
            </button>
          </span>
        </div>

        <div className="scrubber2-panel scrubber-raw-select-modal__preview">
          <div className="scrubber2-panel__head">
            <h3 className="scrubber2-panel__title">Payload preview</h3>
            {selectedId && selectedRow ? (
              <span className="scrubber2-toolbar" style={{ gap: "0.35rem" }}>
                <button
                  type="button"
                  className="scrubber2-btn scrubber2-btn--ghost"
                  onClick={() => {
                    downloadTxt(
                      `scrubbed-${selectedRow.id.slice(0, 8)}.txt`,
                      buildExportDocument({
                        deviceName,
                        eventId: selectedRow.id,
                        objectName: selectedRow.object_name,
                        eventTs: new Date(selectedRow.event_ts).toLocaleString(),
                        payload: previewBody,
                      }),
                    );
                  }}
                >
                  Download .txt
                </button>
                <button
                  type="button"
                  className="scrubber2-btn scrubber2-btn--ghost"
                  onClick={() =>
                    downloadPdf({
                      deviceName,
                      eventId: selectedRow.id,
                      objectName: selectedRow.object_name,
                      eventTs: new Date(selectedRow.event_ts).toLocaleString(),
                      payload: previewBody,
                    })
                  }
                >
                  Download .pdf
                </button>
              </span>
            ) : null}
          </div>
          <div className="scrubber2-panel-body" style={{ paddingTop: 0 }}>
            {!selectedId ? (
              <p className="scrubber2-muted" style={{ margin: 0, fontSize: "0.82rem" }}>
                Select a row and click the eye icon to view the merged JSON payload sample (includes payload_ref when
                present).
              </p>
            ) : (
              <pre className="scrubber-raw-select-modal__pre">{previewBody}</pre>
            )}
          </div>
        </div>
      </div>
    </AppModalShell>
  );
}
