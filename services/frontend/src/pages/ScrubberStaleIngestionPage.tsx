import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type Row = {
  device_id: string;
  device_name: string;
  site_id: string;
  site_name: string;
  scrubber_version: string | null;
  latest_raw_id: string | null;
  latest_raw_ingested_at: string | null;
  raw_object_count: number;
};

type ListResp = { items: Row[]; stale_after_hours: number };

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  } catch {
    return iso;
  }
}

/** Devices with a scrubber draft but no raw ingested within the freshness window. */
export function ScrubberStaleIngestionPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [hours, setHours] = useState(24);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const qs = new URLSearchParams({
        stale_after_hours: String(hours),
        limit: "200",
      });
      const data = await apiFetch<ListResp>(`/scrubber/devices-stale-ingestion?${qs.toString()}`);
      setRows(data?.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
      setRows([]);
    }
  }, [hours]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRefresh(e: FormEvent) {
    e.preventDefault();
    await load();
  }

  return (
    <PageShell title="Scrubber — mapping without recent ingestion">
      <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "1rem", maxWidth: "52rem" }}>
        Lists devices that have a non-empty <code>scrubberStudio</code> draft but no archived raw in the freshness window
        (default 24 hours). Use this to find mappings that are ready while telemetry is missing or delayed.
      </p>
      <p style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
        <Link to="/scrubber/data-objects">View Data_Objects</Link>
        {" · "}
        <Link to="/scrubber/raw-select">Pick raw sample</Link>
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <form onSubmit={onRefresh} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem", alignItems: "flex-end" }}>
        <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.82rem", color: "var(--color-text-muted)" }}>
          Stale if no raw within (hours)
          <input
            type="number"
            min={0.5}
            max={8760}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            style={{
              padding: "0.45rem",
              borderRadius: "var(--radius)",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
              width: "7rem",
            }}
          />
        </label>
        <button
          type="submit"
          style={{
            padding: "0.45rem 0.85rem",
            borderRadius: "var(--radius)",
            border: "none",
            background: "var(--color-accent)",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </form>
      <div style={{ overflow: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.85rem",
          }}
        >
          <thead>
            <tr>
              <th style={th}>Device</th>
              <th style={th}>Site</th>
              <th style={th}>Draft v</th>
              <th style={th}>Raw count</th>
              <th style={th}>Last raw ingest</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.device_id}>
                <td style={td}>{r.device_name}</td>
                <td style={td}>{r.site_name}</td>
                <td style={td}>{r.scrubber_version ?? "—"}</td>
                <td style={td}>{r.raw_object_count}</td>
                <td style={td}>{fmt(r.latest_raw_ingested_at)}</td>
                <td style={td}>
                  {r.latest_raw_id ? (
                    <Link
                      to={`/scrubber/create?rawId=${encodeURIComponent(r.latest_raw_id)}&deviceId=${encodeURIComponent(
                        r.device_id,
                      )}&returnTo=${encodeURIComponent("/scrubber/stale-ingestion")}`}
                      style={{ fontSize: "0.8rem" }}
                    >
                      Open scrubber
                    </Link>
                  ) : (
                    <span style={{ color: "var(--color-text-muted)" }}>No raw yet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !err ? (
          <p style={{ marginTop: "0.75rem", color: "var(--color-text-muted)" }}>No devices match (or all have recent raw).</p>
        ) : null}
      </div>
    </PageShell>
  );
}

const th: CSSProperties = {
  textAlign: "left",
  padding: "0.45rem 0.5rem",
  borderBottom: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
};
const td: CSSProperties = {
  padding: "0.45rem 0.5rem",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "top",
};
