import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type DeviceRow = { id: string; name: string; site_id: string };

type RawRow = {
  id: string;
  ingested_at: string;
  size_bytes: number | null;
  verify_status: string;
  protocol_source: string | null;
};

type ListResp = { items: RawRow[]; total: number };

/** Pick archived raw payloads to drive Scrubber Studio previews (raw stays unchanged in storage). */
export function ScrubberRawSelectPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [rows, setRows] = useState<RawRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const loadRaw = useCallback(async () => {
    if (!deviceId) return;
    setErr(null);
    try {
      const qs = new URLSearchParams({
        device_id: deviceId,
        limit: "50",
        offset: "0",
      });
      const data = await apiFetch<ListResp>(`/raw-data-objects?${qs.toString()}`);
      setRows(data?.items ?? []);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed raw list");
    }
  }, [deviceId]);

  useEffect(() => {
    void (async () => {
      try {
        const d = await apiFetch<{ items: DeviceRow[] }>("/devices");
        setDevices(d?.items ?? []);
        if (d?.items?.length) setDeviceId((prev) => prev || d.items[0].id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed devices");
      }
    })();
  }, []);

  useEffect(() => {
    void loadRaw();
  }, [loadRaw]);

  async function onRefresh(e: FormEvent) {
    e.preventDefault();
    await loadRaw();
  }

  const latest = rows[0];

  return (
    <PageShell title="Scrubber — pick raw sample">
      <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        Choose a device and a recent archived <code>raw_data_object</code>, then open <strong>Scrubber Studio</strong>. The
        studio preview uses the same <code>POST /scrubber/preview</code> path as production workers; raw bytes in MinIO are
        never modified.
      </p>
      <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        Compiled outputs are listed under{" "}
        <Link to="/scrubber/data-objects">View Data_Objects</Link>.
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <form onSubmit={onRefresh} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        <label style={lbl}>
          Device
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            style={{ ...inp, minWidth: "220px" }}
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" style={btn}>
          Refresh list
        </button>
        {latest && (
          <Link
            style={{ alignSelf: "flex-end", fontSize: "0.9rem" }}
            to={`/scrubber/create?rawId=${encodeURIComponent(latest.id)}&deviceId=${encodeURIComponent(
              deviceId,
            )}&returnTo=${encodeURIComponent("/scrubber/raw-select")}`}
          >
            Open studio with latest raw →
          </Link>
        )}
      </form>
      <div style={{ overflow: "auto" }}>
        <table style={tbl}>
          <thead>
            <tr>
              <th style={th}>Raw ID</th>
              <th style={th}>Ingested</th>
              <th style={th}>Size</th>
              <th style={th}>Protocol</th>
              <th style={th}>Verify</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>
                  <code style={{ fontSize: "0.75rem" }}>{r.id.slice(0, 8)}…</code>
                </td>
                <td style={td}>{new Date(r.ingested_at).toLocaleString()}</td>
                <td style={td}>{r.size_bytes ?? "—"}</td>
                <td style={td}>{r.protocol_source ?? "—"}</td>
                <td style={td}>{r.verify_status}</td>
                <td style={td}>
                  <Link
                    to={`/scrubber/create?rawId=${encodeURIComponent(r.id)}&deviceId=${encodeURIComponent(
                      deviceId,
                    )}&returnTo=${encodeURIComponent("/scrubber/raw-select")}`}
                  >
                    Open studio
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && deviceId && (
          <p style={{ color: "var(--color-text-muted)", marginTop: "0.5rem" }}>No raw objects for this device.</p>
        )}
      </div>
    </PageShell>
  );
}

const lbl: CSSProperties = {
  display: "grid",
  gap: "0.25rem",
  fontSize: "0.85rem",
  color: "var(--color-text-muted)",
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
  color: "#fff",
  fontFamily: "inherit",
  fontWeight: 600,
  cursor: "pointer",
  alignSelf: "flex-end",
};

const tbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const th: CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid var(--color-border)",
  padding: "0.4rem",
};
const td: CSSProperties = { borderBottom: "1px solid var(--color-border)", padding: "0.4rem" };
