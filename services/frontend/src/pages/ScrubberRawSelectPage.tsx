import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BrushCleaning } from "lucide-react";
import { apiFetch } from "@/api/client";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";
import "./device-register-page.css";

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
  const returnTo = "/scrubber/raw-select";

  const columns = useMemo<PlainOperationalColumn<RawRow>[]>(() => {
    return [
      {
        id: "id",
        header: "Raw ID",
        cell: (r) => <code style={{ fontSize: "0.75rem" }}>{r.id ? `${r.id.slice(0, 8)}…` : "—"}</code>,
      },
      {
        id: "ingested_at",
        header: "Ingested",
        cell: (r) => new Date(r.ingested_at).toLocaleString(),
      },
      {
        id: "size_bytes",
        header: "Size",
        cell: (r) => String(r.size_bytes ?? "—"),
      },
      {
        id: "protocol_source",
        header: "Protocol",
        cell: (r) => String(r.protocol_source ?? "—"),
      },
      { id: "verify_status", header: "Verify", cell: (r) => r.verify_status },
      {
        id: "studio",
        header: "",
        cell: (r) => (
          <div className="dm-act-grid" style={{ justifyContent: "flex-start" }}>
            <Link
              className="dm-act-grid__btn"
              to={`/scrubber/create?rawId=${encodeURIComponent(r.id)}&deviceId=${encodeURIComponent(
                deviceId,
              )}&returnTo=${encodeURIComponent(returnTo)}`}
              title="Open Scrubber Studio"
              aria-label="Open Scrubber Studio for this raw sample"
            >
              <BrushCleaning size={16} strokeWidth={2} aria-hidden />
            </Link>
          </div>
        ),
      },
    ];
  }, [deviceId]);

  return (
    <PageShell variant="list" className="scrubber-raw-select-page device-manage-page">
      <div className="dm-root">
        <header className="dm-page-hero">
          <div className="dm-page-hero__top">
            <div className="dm-page-hero__titles">
              <h1 className="dm-page-hero__title">Raw sample</h1>
              <p className="dm-page-hero__subtitle">
                Choose a device and a recent archived raw object, then open Scrubber Studio. Raw bytes in storage are never
                modified.
              </p>
            </div>
          </div>
        </header>

        <section className="dm-filter-panel" aria-label="Filters">
          <form noValidate onSubmit={onRefresh} className="dm-controls-form__row">
            <label className="dm-filter-field">
              <span className="dm-filter-field__label">Device</span>
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="dm-btn dm-btn--primary">
              Refresh list
            </button>
            {latest ? (
              <Link
                className="dm-btn dm-btn--outline"
                style={{ alignSelf: "flex-end", textDecoration: "none" }}
                to={`/scrubber/create?rawId=${encodeURIComponent(latest.id)}&deviceId=${encodeURIComponent(
                  deviceId,
                )}&returnTo=${encodeURIComponent("/scrubber/raw-select")}`}
              >
                Open studio (latest)
              </Link>
            ) : null}
          </form>
        </section>

        {err ? <PageStatus variant="error">{err}</PageStatus> : null}

        <div className="dm-table-wrap">
          <div className="dm-device-table-shell">
            <div className="dm-table-scroll">
              <PlainOperationalTable<RawRow>
                rows={rows}
                columns={columns}
                getRowId={(r) => r.id}
                bordered
                emptyMessage={deviceId ? "No raw objects for this device." : "Select a device."}
                resetPageKey={deviceId}
              />
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
