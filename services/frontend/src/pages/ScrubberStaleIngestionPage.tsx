import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  createStaticIngestion,
  getStaticIngestion,
  listStaticIngestions,
  updateStaticIngestion,
  validateStaticIngestion,
  type StaticIngestionListItem,
} from "@/api/staticIngestion";
import { apiFetch } from "@/api/client";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { PageStatus } from "@/components/PageStatus";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { PageShell } from "@/layouts/PageShell";
import "./device-register-page.css";

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

type SiteRow = { id: string; name: string };

type Tab = "devices" | "static";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  } catch {
    return iso;
  }
}

/** `datetime-local` value from an ISO timestamp (browser local). */
function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultSchedule(kind: string): Record<string, unknown> {
  switch (kind) {
    case "hourly":
      return { kind: "hourly", minute: 0 };
    case "daily":
      return { kind: "daily", hour: 9, minute: 0 };
    case "alternate_days":
      return { kind: "alternate_days", hour: 9, minute: 0 };
    case "weekly":
      return { kind: "weekly", days_of_week: [0, 2, 4], hour: 9, minute: 0 };
    case "monthly":
      return { kind: "monthly", day_of_month: 1, hour: 9, minute: 0 };
    case "cron":
      return { kind: "cron", expression: "0 9 * * *" };
    default:
      return { kind: "daily", hour: 9, minute: 0 };
  }
}

/** Devices with a scrubber draft but no raw ingested within the freshness window; plus static JSON ingestions. */
export function ScrubberStaleIngestionPage() {
  const { siteId: opsSiteId } = useOpsShell();
  const [tab, setTab] = useState<Tab>("devices");

  const [rows, setRows] = useState<Row[]>([]);
  const [hours, setHours] = useState(24);
  const [err, setErr] = useState<string | null>(null);

  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState("");
  const [staticQ, setStaticQ] = useState("");
  const [staticRows, setStaticRows] = useState<StaticIngestionListItem[]>([]);
  const [staticErr, setStaticErr] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [siName, setSiName] = useState("");
  const [siDesc, setSiDesc] = useState("");
  const [siEndLocal, setSiEndLocal] = useState("");
  const [siScheduleKind, setSiScheduleKind] = useState("daily");
  const [siSchedule, setSiSchedule] = useState<Record<string, unknown>>(() => defaultSchedule("daily"));
  const [siPayloadText, setSiPayloadText] = useState('{\n  "example": true\n}\n');
  const [siBusy, setSiBusy] = useState(false);
  const [siValErrs, setSiValErrs] = useState<string[]>([]);
  const [siOk, setSiOk] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
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

  const loadStatic = useCallback(async () => {
    if (!siteId) {
      setStaticRows([]);
      return;
    }
    setStaticErr(null);
    try {
      const data = await listStaticIngestions(siteId, { q: staticQ.trim() || undefined });
      setStaticRows(data?.items ?? []);
    } catch (e) {
      setStaticErr(e instanceof Error ? e.message : "Failed to load static ingestions");
      setStaticRows([]);
    }
  }, [siteId, staticQ]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<SiteRow[]>("/administration/sites");
        setSites(data ?? []);
      } catch {
        setSites([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (opsSiteId) setSiteId(opsSiteId);
  }, [opsSiteId]);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    if (tab === "static") void loadStatic();
  }, [tab, loadStatic]);

  async function onRefreshDevices(e?: FormEvent) {
    e?.preventDefault();
    await loadDevices();
  }

  function openCreateModal() {
    setEditingId(null);
    setSiName("");
    setSiDesc("");
    setSiEndLocal("");
    setSiScheduleKind("daily");
    setSiSchedule(defaultSchedule("daily"));
    setSiPayloadText('{\n  "example": true\n}\n');
    setSiValErrs([]);
    setSiOk(null);
    setModalOpen(true);
  }

  async function openEditModal(id: string) {
    setModalLoading(true);
    setSiValErrs([]);
    setSiOk(null);
    setStaticErr(null);
    try {
      const row = await getStaticIngestion(id);
      if (!row) {
        setStaticErr("Static ingestion not found");
        return;
      }
      setEditingId(row.id);
      setSiName(row.name);
      setSiDesc(row.description ?? "");
      setSiEndLocal(isoToDatetimeLocal(row.end_at));
      const sk = String((row.schedule_json as { kind?: string })?.kind ?? "daily").toLowerCase();
      const allowed = new Set(["hourly", "daily", "alternate_days", "weekly", "monthly", "cron"]);
      const kind = allowed.has(sk) ? sk : "daily";
      setSiScheduleKind(kind);
      setSiSchedule(
        row.schedule_json && typeof row.schedule_json === "object"
          ? { ...row.schedule_json }
          : defaultSchedule(kind),
      );
      setSiPayloadText(JSON.stringify(row.payload_json ?? {}, null, 2));
      setModalOpen(true);
    } catch (e) {
      setStaticErr(e instanceof Error ? e.message : "Failed to load static ingestion");
    } finally {
      setModalLoading(false);
    }
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
  }

  function onScheduleKindChange(k: string) {
    setSiScheduleKind(k);
    setSiSchedule(defaultSchedule(k));
  }

  function patchSchedule(patch: Record<string, unknown>) {
    setSiSchedule((s) => ({ ...s, ...patch }));
  }

  async function onValidateStatic() {
    setSiValErrs([]);
    setSiOk(null);
    if (!siteId) {
      setSiValErrs(["Select a site first."]);
      return;
    }
    let payload_json: Record<string, unknown>;
    try {
      payload_json = JSON.parse(siPayloadText) as Record<string, unknown>;
      if (!payload_json || typeof payload_json !== "object" || Array.isArray(payload_json)) {
        setSiValErrs(["Payload must be a JSON object."]);
        return;
      }
    } catch {
      setSiValErrs(["Payload JSON has a syntax error."]);
      return;
    }
    const end_at = siEndLocal.trim() ? new Date(siEndLocal).toISOString() : null;
    setSiBusy(true);
    try {
      const r = await validateStaticIngestion({
        site_id: siteId,
        name: siName.trim() || "unnamed",
        description: siDesc.trim() || null,
        end_at,
        schedule_json: { ...siSchedule, kind: siScheduleKind },
        payload_json,
      });
      if (r?.valid) setSiOk("Validation passed — you can save.");
      else setSiValErrs(r?.errors ?? ["Validation failed"]);
    } catch (e) {
      setSiValErrs([e instanceof Error ? e.message : "Validate failed"]);
    } finally {
      setSiBusy(false);
    }
  }

  async function onSaveStatic() {
    setSiValErrs([]);
    setSiOk(null);
    if (!siteId) {
      setSiValErrs(["Select a site first."]);
      return;
    }
    if (!siName.trim()) {
      setSiValErrs(["Ingestion name is required."]);
      return;
    }
    let payload_json: Record<string, unknown>;
    try {
      payload_json = JSON.parse(siPayloadText) as Record<string, unknown>;
    } catch {
      setSiValErrs(["Payload JSON has a syntax error."]);
      return;
    }
    const end_at = siEndLocal.trim() ? new Date(siEndLocal).toISOString() : null;
    setSiBusy(true);
    try {
      const v = await validateStaticIngestion({
        site_id: siteId,
        name: siName.trim(),
        description: siDesc.trim() || null,
        end_at,
        schedule_json: { ...siSchedule, kind: siScheduleKind },
        payload_json,
      });
      if (!v?.valid) {
        setSiValErrs(v?.errors ?? ["Validation failed"]);
        return;
      }
      const schedule_json = { ...siSchedule, kind: siScheduleKind };
      if (editingId) {
        await updateStaticIngestion(editingId, {
          name: siName.trim(),
          description: siDesc.trim() || null,
          end_at,
          schedule_json,
          payload_json,
        });
      } else {
        await createStaticIngestion({
          site_id: siteId,
          name: siName.trim(),
          description: siDesc.trim() || null,
          end_at,
          schedule_json,
          payload_json,
        });
      }
      closeModal();
      await loadStatic();
    } catch (e) {
      setSiValErrs([e instanceof Error ? e.message : "Save failed"]);
    } finally {
      setSiBusy(false);
    }
  }

  function onPayloadFile(f: File | null) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const t = typeof reader.result === "string" ? reader.result : "";
      setSiPayloadText(t);
    };
    reader.readAsText(f);
  }

  const staleColumns = useMemo<PlainOperationalColumn<Row>[]>(() => {
    const returnTo = "/scrubber/stale-ingestion";
    return [
      { id: "device_name", header: "Device", cell: (r) => r.device_name },
      { id: "site_name", header: "Site", cell: (r) => r.site_name },
      {
        id: "scrubber_version",
        header: "Draft v",
        cell: (r) => String(r.scrubber_version ?? "—"),
      },
      { id: "raw_object_count", header: "Raw count", cell: (r) => String(r.raw_object_count) },
      {
        id: "latest_raw_ingested_at",
        header: "Last raw ingest",
        cell: (r) => fmt(r.latest_raw_ingested_at),
      },
      {
        id: "actions",
        header: "Actions",
        cell: (r) => {
          if (!r.latest_raw_id) return <span style={{ color: "var(--color-text-muted)" }}>No raw yet</span>;
          return (
            <Link
              to={`/scrubber/create?rawId=${encodeURIComponent(r.latest_raw_id)}&deviceId=${encodeURIComponent(
                r.device_id,
              )}&returnTo=${encodeURIComponent(returnTo)}`}
              style={{ fontSize: "0.8rem" }}
            >
              Open scrubber
            </Link>
          );
        },
      },
    ];
  }, []);

  const staticColumns = useMemo<PlainOperationalColumn<StaticIngestionListItem>[]>(() => {
    return [
      { id: "name", header: "Name", cell: (r) => r.name },
      {
        id: "description",
        header: "Description",
        cell: (r) => String(r.description ?? "—"),
      },
      {
        id: "end_at",
        header: "End",
        cell: (r) => fmt(r.end_at),
      },
      {
        id: "updated_at",
        header: "Updated",
        cell: (r) => fmt(r.updated_at),
      },
      {
        id: "actions",
        header: "Actions",
        cell: (r) => (
          <button
            type="button"
            disabled={modalLoading}
            onClick={() => void openEditModal(r.id)}
            style={{
              padding: "0.25rem 0.5rem",
              fontSize: "0.8rem",
              borderRadius: "var(--radius)",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-elevated)",
              color: "var(--color-accent)",
              fontWeight: 600,
              cursor: modalLoading ? "wait" : "pointer",
            }}
          >
            Edit
          </button>
        ),
      },
    ];
  }, [modalLoading, openEditModal]);

  return (
    <PageShell variant="list" className="scrubber-stale-page device-manage-page">
      <div className="dm-root">
        <header className="dm-page-hero">
          <div className="dm-page-hero__top">
            <div className="dm-page-hero__titles">
              <h1 className="dm-page-hero__title">Stale ingestion</h1>
              <p className="dm-page-hero__subtitle">
                Draft mappings without recent raw, or static JSON schedules per site.
              </p>
            </div>
          </div>
        </header>

        <section className="dm-filter-panel" aria-label="View mode">
          <div className="dm-controls-form__row">
            <button
              type="button"
              className={tab === "devices" ? "dm-btn dm-btn--primary" : "dm-btn dm-btn--outline"}
              onClick={() => setTab("devices")}
            >
              Devices without raw
            </button>
            <button
              type="button"
              className={tab === "static" ? "dm-btn dm-btn--primary" : "dm-btn dm-btn--outline"}
              onClick={() => setTab("static")}
            >
              Static JSON
            </button>
            <span className="dm-inline-summary" style={{ margin: 0, alignSelf: "center" }}>
              <Link to="/scrubber/data-objects" className="dm-name-link">
                Data objects
              </Link>
              {" · "}
              <Link to="/scrubber/raw-select" className="dm-name-link">
                Pick raw sample
              </Link>
            </span>
          </div>
        </section>

      {tab === "devices" ? (
        <>
          {err ? <PageStatus variant="error">{err}</PageStatus> : null}
          <section className="dm-filter-panel" aria-label="Stale window">
            <form noValidate onSubmit={onRefreshDevices} className="dm-controls-form__row">
              <label className="dm-filter-field">
                <span className="dm-filter-field__label">Stale if no raw (hours)</span>
                <input
                  type="number"
                  min={0.5}
                  max={8760}
                  step={0.5}
                  value={Number.isFinite(hours) ? hours : 24}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    if (!Number.isFinite(n)) return;
                    setHours(Math.min(8760, Math.max(0.5, n)));
                  }}
                />
              </label>
              <button type="button" className="dm-btn dm-btn--primary" onClick={() => void onRefreshDevices()} aria-label="Refresh stale mapping list">
                Refresh
              </button>
            </form>
          </section>
          <div className="dm-table-wrap">
            <div className="dm-device-table-shell">
              <div className="dm-table-scroll">
            <PlainOperationalTable<Row>
              rows={rows}
              columns={staleColumns}
              getRowId={(r) => r.device_id}
              bordered
              emptyMessage={err ? undefined : "No devices match (or all have recent raw)."}
              resetPageKey={hours}
            />
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <section className="dm-filter-panel" aria-label="Static ingestions">
            <div className="dm-controls-form__row">
              <label className="dm-filter-field">
                <span className="dm-filter-field__label">Site</span>
                <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  <option value="">— Select site —</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="dm-filter-field">
                <span className="dm-filter-field__label">Search</span>
                <input
                  value={staticQ}
                  onChange={(e) => setStaticQ(e.target.value)}
                  onBlur={() => void loadStatic()}
                  placeholder="Name or description…"
                />
              </label>
              <button type="button" className="dm-btn dm-btn--outline" disabled={!siteId} onClick={() => void loadStatic()}>
                Search
              </button>
              <button type="button" className="dm-btn dm-btn--primary" disabled={!siteId} onClick={openCreateModal}>
                Create
              </button>
            </div>
          </section>
          {staticErr ? <PageStatus variant="error">{staticErr}</PageStatus> : null}
          <div className="dm-table-wrap">
            <div className="dm-device-table-shell">
              <div className="dm-table-scroll">
                {siteId ? (
                  <PlainOperationalTable<StaticIngestionListItem>
                    rows={staticRows}
                    columns={staticColumns}
                    getRowId={(r) => r.id}
                    bordered
                    emptyMessage={staticErr ? undefined : "No static ingestions yet — create one."}
                    resetPageKey={`${siteId}|${staticQ}|${staticRows.length}`}
                  />
                ) : (
                  <p className="dm-inline-summary" style={{ margin: "0.75rem 0 0" }}>
                    Select a site to list static ingestions.
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      </div>

      {modalOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
          onClick={() => !siBusy && closeModal()}
          onKeyDown={(e) => e.key === "Escape" && !siBusy && closeModal()}
          role="presentation"
        >
          <div
            style={{
              background: "var(--color-surface-elevated)",
              color: "var(--color-text)",
              borderRadius: "var(--radius)",
              maxWidth: "min(920px, 100%)",
              width: "100%",
              maxHeight: "min(92vh, 900px)",
              overflow: "auto",
              padding: "1rem",
              border: "1px solid var(--color-border)",
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.05rem" }}>
              {editingId ? "Edit static ingestion" : "New static ingestion"}
            </h2>
            <div style={formGrid}>
              <label style={lblRow}>
                <span style={lblRowLabel}>Ingestion name</span>
                <input value={siName} onChange={(e) => setSiName(e.target.value)} style={{ ...inp, ...inpGrow }} disabled={siBusy} />
              </label>
              <label style={{ ...lblRow, alignItems: "flex-start" }}>
                <span style={{ ...lblRowLabel, paddingTop: "0.35rem" }}>Description</span>
                <textarea value={siDesc} onChange={(e) => setSiDesc(e.target.value)} rows={2} style={{ ...inp, ...inpGrow, resize: "vertical" }} disabled={siBusy} />
              </label>
              <label style={lblRow}>
                <span style={lblRowLabel}>End (optional, local)</span>
                <input
                  type="datetime-local"
                  value={siEndLocal}
                  onChange={(e) => setSiEndLocal(e.target.value)}
                  style={{ ...inp, ...inpGrow }}
                  disabled={siBusy}
                />
              </label>
              <label style={lblRow}>
                <span style={lblRowLabel}>Schedule</span>
                <select value={siScheduleKind} onChange={(e) => onScheduleKindChange(e.target.value)} style={{ ...inp, ...inpGrow }} disabled={siBusy}>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Every day</option>
                  <option value="alternate_days">Alternate days</option>
                  <option value="weekly">Specific weekdays</option>
                  <option value="monthly">Monthly (day of month)</option>
                  <option value="cron">Cron expression</option>
                </select>
              </label>
            {siScheduleKind === "hourly" ? (
              <label style={lblRow}>
                <span style={lblRowLabel}>Minute offset (0–59)</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={Number(siSchedule.minute ?? 0)}
                  onChange={(e) => patchSchedule({ minute: Number(e.target.value) })}
                  style={{ ...inp, ...inpGrow, maxWidth: "7rem" }}
                  disabled={siBusy}
                />
              </label>
            ) : null}
            {(siScheduleKind === "daily" || siScheduleKind === "alternate_days") ? (
              <div style={schedulePair}>
                <label style={{ ...lblRow, flex: "1 1 12rem", marginBottom: 0 }}>
                  <span style={lblRowLabel}>Hour (0–23)</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={Number(siSchedule.hour ?? 0)}
                    onChange={(e) => patchSchedule({ hour: Number(e.target.value) })}
                    style={{ ...inp, width: "100%", maxWidth: "8rem" }}
                    disabled={siBusy}
                  />
                </label>
                <label style={{ ...lblRow, flex: "1 1 12rem", marginBottom: 0 }}>
                  <span style={lblRowLabel}>Minute (0–59)</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={Number(siSchedule.minute ?? 0)}
                    onChange={(e) => patchSchedule({ minute: Number(e.target.value) })}
                    style={{ ...inp, width: "100%", maxWidth: "8rem" }}
                    disabled={siBusy}
                  />
                </label>
              </div>
            ) : null}
            {siScheduleKind === "weekly" ? (
              <>
                <label style={lblRow}>
                  <span style={lblRowLabel}>Hour / minute</span>
                  <div style={{ display: "flex", gap: "0.35rem", flex: 1, minWidth: 0 }}>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={Number(siSchedule.hour ?? 0)}
                      onChange={(e) => patchSchedule({ hour: Number(e.target.value) })}
                      style={{ ...inp, flex: 1, minWidth: 0 }}
                      disabled={siBusy}
                    />
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={Number(siSchedule.minute ?? 0)}
                      onChange={(e) => patchSchedule({ minute: Number(e.target.value) })}
                      style={{ ...inp, flex: 1, minWidth: 0 }}
                      disabled={siBusy}
                    />
                  </div>
                </label>
                <label style={{ ...lblRow, alignItems: "flex-start" }}>
                  <span style={{ ...lblRowLabel, paddingTop: "0.35rem" }}>Weekdays (0=Mon … 6=Sun)</span>
                  <input
                    value={(siSchedule.days_of_week as number[] | undefined)?.join(",") ?? "0,1,2,3,4,5,6"}
                    onChange={(e) => {
                      const parts = e.target.value
                        .split(",")
                        .map((x) => parseInt(x.trim(), 10))
                        .filter((n) => !Number.isNaN(n));
                      patchSchedule({ days_of_week: parts });
                    }}
                    style={{ ...inp, ...inpGrow }}
                    disabled={siBusy}
                  />
                </label>
              </>
            ) : null}
            {siScheduleKind === "monthly" ? (
              <div style={schedulePair}>
                <label style={{ ...lblRow, flex: "1 1 10rem", marginBottom: 0 }}>
                  <span style={lblRowLabel}>Day (1–31)</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={Number(siSchedule.day_of_month ?? 1)}
                    onChange={(e) => patchSchedule({ day_of_month: Number(e.target.value) })}
                    style={{ ...inp, maxWidth: "8rem" }}
                    disabled={siBusy}
                  />
                </label>
                <label style={{ ...lblRow, flex: "1 1 14rem", marginBottom: 0 }}>
                  <span style={lblRowLabel}>Hour / min</span>
                  <div style={{ display: "flex", gap: "0.35rem", flex: 1, minWidth: 0 }}>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={Number(siSchedule.hour ?? 0)}
                      onChange={(e) => patchSchedule({ hour: Number(e.target.value) })}
                      style={{ ...inp, flex: 1, minWidth: 0 }}
                      disabled={siBusy}
                    />
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={Number(siSchedule.minute ?? 0)}
                      onChange={(e) => patchSchedule({ minute: Number(e.target.value) })}
                      style={{ ...inp, flex: 1, minWidth: 0 }}
                      disabled={siBusy}
                    />
                  </div>
                </label>
              </div>
            ) : null}
            {siScheduleKind === "cron" ? (
              <label style={lblRow}>
                <span style={lblRowLabel}>Cron expression</span>
                <input
                  value={String(siSchedule.expression ?? "0 9 * * *")}
                  onChange={(e) => patchSchedule({ expression: e.target.value })}
                  style={{ ...inp, ...inpGrow, fontFamily: "monospace" }}
                  disabled={siBusy}
                />
              </label>
            ) : null}
            <label style={{ ...lblRow, alignItems: "flex-start" }}>
              <span style={{ ...lblRowLabel, paddingTop: "0.35rem" }}>JSON payload</span>
              <textarea value={siPayloadText} onChange={(e) => setSiPayloadText(e.target.value)} rows={8} style={{ ...inp, ...inpGrow, fontFamily: "monospace", fontSize: "0.78rem", minHeight: "10rem" }} disabled={siBusy} />
            </label>
            <label style={lblRow}>
              <span style={lblRowLabel}>Load from file</span>
              <input type="file" accept="application/json,.json" onChange={(e) => onPayloadFile(e.target.files?.[0] ?? null)} disabled={siBusy} style={inpGrow} />
            </label>
            </div>
            {siValErrs.length > 0 ? (
              <PageStatus variant="error">
                <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  {siValErrs.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </PageStatus>
            ) : null}
            {siOk ? <PageStatus variant="success">{siOk}</PageStatus> : null}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
              <button type="button" style={btnPrimary} disabled={siBusy} onClick={() => void onValidateStatic()}>
                Validate
              </button>
              <button type="button" style={btnPrimary} disabled={siBusy} onClick={() => void onSaveStatic()}>
                Save
              </button>
              <button type="button" style={btnGhost} disabled={siBusy} onClick={closeModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

const formGrid: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
};
const schedulePair: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
  alignItems: "flex-end",
};
const lblRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.85rem",
  color: "var(--color-text-muted)",
};
const lblRowLabel: CSSProperties = {
  minWidth: "10rem",
  flexShrink: 0,
};
const inpGrow: CSSProperties = {
  flex: "1 1 14rem",
  minWidth: 0,
};
const inp: CSSProperties = {
  padding: "0.35rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
};
const btnPrimary: CSSProperties = {
  minHeight: "var(--btn-min-height)",
  padding: "var(--btn-padding-y) var(--btn-padding-x)",
  fontSize: "var(--btn-font-size)",
  border: "none",
  borderRadius: "var(--radius)",
  background:
    "linear-gradient(180deg, color-mix(in oklab, var(--color-accent) 90%, #fff 10%), color-mix(in oklab, var(--color-accent) 86%, #000 14%))",
  color: "var(--btn-on-accent)",
  fontWeight: 600,
  cursor: "pointer",
  boxSizing: "border-box",
};
const btnGhost: CSSProperties = {
  ...btnPrimary,
  background: "var(--color-border)",
  color: "var(--color-text)",
};
