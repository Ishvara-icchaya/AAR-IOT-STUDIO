import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { AppModalShell } from "@/components/app/AppModalShell";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type RawRow = {
  id: string;
  device_id: string;
  device_name: string;
  site_id: string;
  site_name: string;
  protocol_source: string | null;
  captured_at: string | null;
  ingested_at: string;
  size_bytes: number | null;
};

type ListResp = { items: RawRow[]; total: number };

type AggregatedGroup = {
  device_id: string;
  object_name: string;
  site_id: string;
  site_name: string;
  archive_count: number;
  latest_ingested_at: string;
  latest_raw_id: string;
  protocol_source: string | null;
};

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

function aggregateByObjectName(rows: RawRow[]): AggregatedGroup[] {
  const map = new Map<string, AggregatedGroup>();
  for (const r of rows) {
    const key = r.device_id;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        device_id: r.device_id,
        object_name: r.device_name || "—",
        site_id: r.site_id,
        site_name: r.site_name,
        archive_count: 1,
        latest_ingested_at: r.ingested_at,
        latest_raw_id: r.id,
        protocol_source: r.protocol_source,
      });
      continue;
    }
    cur.archive_count += 1;
    if (new Date(r.ingested_at).getTime() > new Date(cur.latest_ingested_at).getTime()) {
      cur.latest_ingested_at = r.ingested_at;
      cur.latest_raw_id = r.id;
      cur.protocol_source = r.protocol_source;
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.latest_ingested_at).getTime() - new Date(a.latest_ingested_at).getTime(),
  );
}

function fmtIso(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

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

function RawActionsCell({
  g,
  busyPayload,
  onOpenPayload,
}: {
  g: AggregatedGroup;
  busyPayload: string | null;
  onOpenPayload: (objectName: string, rawId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
      <button
        type="button"
        style={sbtn}
        disabled={busyPayload !== null}
        onClick={() => onOpenPayload(g.object_name, g.latest_raw_id)}
      >
        {busyPayload === g.latest_raw_id ? "Loading…" : "View payload"}
      </button>
      <Link
        to={`/scrubber/create?rawId=${encodeURIComponent(
          g.latest_raw_id,
        )}&deviceId=${encodeURIComponent(g.device_id)}&returnTo=${encodeURIComponent("/devices/raw")}`}
        style={{ fontSize: "0.8rem" }}
      >
        Scrubber
      </Link>
    </div>
  );
}

function RawArchiveAggregateGrid({
  groups,
  busyPayload,
  onOpenPayload,
}: {
  groups: AggregatedGroup[];
  busyPayload: string | null;
  onOpenPayload: (objectName: string, rawId: string) => void;
}) {
  const columns = useMemo<PlainOperationalColumn<AggregatedGroup>[]>(() => {
    return [
      { id: "object_name", header: "Object name", cell: (g) => g.object_name },
      { id: "site_name", header: "Site", cell: (g) => g.site_name },
      { id: "archive_count", header: "Archives", cell: (g) => String(g.archive_count) },
      {
        id: "latest_ingested_at",
        header: "Latest ingested",
        cell: (g) => fmtIso(g.latest_ingested_at),
      },
      {
        id: "protocol_source",
        header: "Protocol",
        cell: (g) => String(g.protocol_source ?? "—"),
      },
      {
        id: "actions",
        header: "Actions",
        cell: (g) => <RawActionsCell g={g} busyPayload={busyPayload} onOpenPayload={onOpenPayload} />,
      },
    ];
  }, [busyPayload, onOpenPayload]);

  return (
    <PlainOperationalTable<AggregatedGroup>
      rows={groups}
      columns={columns}
      getRowId={(g) => g.device_id}
      bordered
      emptyMessage="No rows."
      maxHeight="min(60vh, 520px)"
    />
  );
}

export function DeviceRawDataPage() {
  const [searchParams] = useSearchParams();
  const deviceIdFilter = searchParams.get("deviceId") ?? "";

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<RawRow[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busyPayload, setBusyPayload] = useState<string | null>(null);
  const [payloadModal, setPayloadModal] = useState<{
    title: string;
    rawId: string;
    preview: RawPreview | null;
    error: string | null;
  } | null>(null);

  const groups = useMemo(() => aggregateByObjectName(rows), [rows]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const qs = new URLSearchParams({ limit: "200", offset: "0" });
      if (deviceIdFilter.trim()) {
        qs.set("device_id", deviceIdFilter.trim());
      } else if (q.trim()) {
        qs.set("q", q.trim());
      }
      const data = await apiFetch<ListResp>(`/raw-data-objects?${qs.toString()}`);
      const items = data?.items ?? [];
      setRows(
        items.map((r) => ({
          id: r.id,
          device_id: r.device_id,
          device_name: r.device_name,
          site_id: r.site_id,
          site_name: r.site_name,
          protocol_source: r.protocol_source,
          captured_at: r.captured_at,
          ingested_at: r.ingested_at,
          size_bytes: r.size_bytes,
        })),
      );
      setTotal(data?.total ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, [deviceIdFilter, q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    await load();
  }

  async function openPayload(objectName: string, rawId: string) {
    setBusyPayload(rawId);
    setPayloadModal({ title: objectName, rawId, preview: null, error: null });
    try {
      const prev = await apiFetch<RawPreview>(
        `/raw-data-objects/${encodeURIComponent(rawId)}/preview?max_bytes=262144`,
      );
      setPayloadModal({ title: objectName, rawId, preview: prev ?? null, error: null });
    } catch (e) {
      setPayloadModal({
        title: objectName,
        rawId,
        preview: null,
        error: e instanceof Error ? e.message : "Failed to load payload",
      });
    } finally {
      setBusyPayload(null);
    }
  }

  function closePayloadModal() {
    setPayloadModal(null);
  }

  const manageDevicesHref = "/devices/register#registered-devices-table";

  return (
    <PageShell>
      <nav style={backNav} aria-label="Back to manage devices">
        <Link to={manageDevicesHref} style={backLink}>
          ← Manage Devices
        </Link>
      </nav>
      {deviceIdFilter ? (
        <p style={{ fontSize: "0.9rem", color: "var(--color-accent)", marginBottom: "0.75rem" }}>
          Showing raw archives for the selected device only.{" "}
          <Link to="/devices/raw" style={{ fontWeight: 600 }}>
            Clear filter
          </Link>
        </p>
      ) : null}
      <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        Rows are <strong>aggregated by object name</strong> (registered device). Each line summarizes all raw archives for
        that device; <strong>View payload</strong> loads the <em>latest</em> archive for that device.
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <form onSubmit={onSearch} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...inp, flex: "1 1 200px" }}
        />
        <button type="submit" style={btn}>
          Search
        </button>
        <button type="button" style={sbtn} onClick={() => void load()}>
          Refresh
        </button>
      </form>
      <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
        Total raw archives (tenant filter): {total}
        {rows.length < total ? (
          <span>
            {" "}
            — aggregates built from the {rows.length} most recent rows returned by the API (limit 200).
          </span>
        ) : null}
      </p>
      <div className="table-scroll-sticky" style={{ overflow: "auto", marginTop: "0.5rem" }}>
        <RawArchiveAggregateGrid groups={groups} busyPayload={busyPayload} onOpenPayload={(name, id) => void openPayload(name, id)} />
      </div>

      <AppModalShell
        open={!!payloadModal}
        onClose={closePayloadModal}
        title={payloadModal ? `Payload — ${payloadModal.title}` : "Payload"}
        titleId="raw-payload-title"
        size="lg"
      >
        {payloadModal ? (
          <>
            <p style={modalMeta}>
              <code style={{ fontSize: "0.72rem" }}>{payloadModal.rawId}</code>
            </p>
            {payloadModal.error ? <PageStatus variant="error">{payloadModal.error}</PageStatus> : null}
            {payloadModal.preview ? (
              <>
                {payloadModal.preview.truncated ? (
                  <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
                    Showing first {payloadModal.preview.returned_bytes} of{" "}
                    {payloadModal.preview.total_size ?? "?"} bytes (truncated).
                  </p>
                ) : null}
                <pre style={prePayload}>
                  {payloadModal.preview.encoding === "utf8" && payloadModal.preview.text != null
                    ? formatPayloadPreview(payloadModal.preview.text, payloadModal.preview.content_type)
                    : payloadModal.preview.encoding === "base64" && payloadModal.preview.base64
                      ? `[binary base64, ${payloadModal.preview.base64.length} chars]\n${payloadModal.preview.base64.slice(0, 8000)}${payloadModal.preview.base64.length > 8000 ? "…" : ""}`
                      : "—"}
                </pre>
              </>
            ) : !payloadModal.error ? (
              <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>
            ) : null}
          </>
        ) : null}
      </AppModalShell>
    </PageShell>
  );
}

const backNav: CSSProperties = {
  marginBottom: "0.75rem",
};

const backLink: CSSProperties = {
  display: "inline-block",
  fontSize: "0.88rem",
  fontWeight: 600,
  color: "var(--color-accent)",
  textDecoration: "none",
};

const inp: CSSProperties = {
  padding: "0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
};

const btn: CSSProperties = {
  padding: "0.55rem 0.85rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "var(--btn-on-accent)",
  fontFamily: "inherit",
  fontWeight: 600,
  cursor: "pointer",
};

const sbtn: CSSProperties = {
  padding: "0.3rem 0.45rem",
  fontSize: "0.75rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text)",
  cursor: "pointer",
  fontFamily: "inherit",
};

const modalMeta: CSSProperties = {
  margin: "0 0 0.35rem",
  fontSize: "0.72rem",
  color: "var(--color-text-muted)",
};

const prePayload: CSSProperties = {
  margin: "0.75rem 0 0",
  padding: "0.65rem",
  overflow: "auto",
  flex: 1,
  minHeight: 0,
  fontSize: "0.78rem",
  lineHeight: 1.45,
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "4px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
