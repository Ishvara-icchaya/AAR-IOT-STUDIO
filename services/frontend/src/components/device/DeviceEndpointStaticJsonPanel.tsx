/**
 * Per-device static JSON schedules (site is the device's site). Payloads may use `"$expr"`
 * string fields for values evaluated when the schedule fires — same downstream path as MQTT/REST raw ingest.
 */
import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createStaticIngestion,
  getStaticIngestion,
  listStaticIngestions,
  updateStaticIngestion,
  validateStaticIngestion,
  type StaticIngestionListItem,
} from "@/api/staticIngestion";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { AppButton } from "@/components/app";
import { PageStatus } from "@/components/PageStatus";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  } catch {
    return iso;
  }
}

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

export function DeviceEndpointStaticJsonPanel({
  deviceId,
  siteId,
  siteName,
  deviceName,
}: {
  deviceId: string;
  siteId: string;
  deviceName: string;
  siteName?: string;
}) {
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
  const [siPayloadText, setSiPayloadText] = useState(
    '{\n  "reading": { "$expr": "now_iso" }\n}\n',
  );
  const [siBusy, setSiBusy] = useState(false);
  const [siValErrs, setSiValErrs] = useState<string[]>([]);
  const [siOk, setSiOk] = useState<string | null>(null);

  const loadStatic = useCallback(async () => {
    setStaticErr(null);
    try {
      const data = await listStaticIngestions({
        device_id: deviceId,
        q: staticQ.trim() || undefined,
      });
      setStaticRows(data?.items ?? []);
    } catch (e) {
      setStaticErr(e instanceof Error ? e.message : "Failed to load static ingestions");
      setStaticRows([]);
    }
  }, [deviceId, staticQ]);

  useEffect(() => {
    void loadStatic();
  }, [loadStatic]);

  function openCreateModal() {
    setEditingId(null);
    setSiName("");
    setSiDesc("");
    setSiEndLocal("");
    setSiScheduleKind("daily");
    setSiSchedule(defaultSchedule("daily"));
    setSiPayloadText('{\n  "reading": { "$expr": "now_iso" }\n}\n');
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
        device_id: deviceId,
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
        device_id: deviceId,
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
          device_id: deviceId,
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
          <AppButton
            type="button"
            variant="secondary"
            disabled={modalLoading}
            onClick={() => void openEditModal(r.id)}
          >
            Edit
          </AppButton>
        ),
      },
    ];
  }, [modalLoading]);

  const siteLine = siteName ? `${siteName} · ` : "";

  return (
    <div className="device-endpoint-static-json">
      <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", margin: "0 0 0.75rem", lineHeight: 1.45 }}>
        <strong>{deviceName}</strong> — {siteLine}
        Site is fixed to this device. Scheduled payloads are archived like MQTT/REST and can drive workflows (Static
        nodes). Use object keys <code style={{ fontSize: "0.72rem" }}>$expr</code> with string values for
        expression-based fields (evaluated when the job runs).
      </p>
      <section className="dm-filter-panel" aria-label="Static ingestions" style={{ marginBottom: "0.75rem" }}>
        <form
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void loadStatic();
          }}
          className="dm-controls-form__row"
          style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}
        >
          <label className="dm-filter-field" style={{ flex: "1 1 12rem" }}>
            <span className="dm-filter-field__label">Search</span>
            <input
              value={staticQ}
              onChange={(e) => setStaticQ(e.target.value)}
              placeholder="Name or description…"
            />
          </label>
          <AppButton type="submit" variant="secondary">
            Search
          </AppButton>
          <AppButton type="button" variant="primary" onClick={openCreateModal}>
            Create
          </AppButton>
        </form>
      </section>
      {staticErr ? <PageStatus variant="error">{staticErr}</PageStatus> : null}
      <div className="dm-table-wrap">
        <div className="dm-device-table-shell">
          <div className="dm-table-scroll">
            <PlainOperationalTable<StaticIngestionListItem>
              rows={staticRows}
              columns={staticColumns}
              getRowId={(r) => r.id}
              bordered
              emptyMessage={staticErr ? undefined : "No static JSON sources yet — create one for this device."}
              resetPageKey={`${deviceId}|${staticQ}|${staticRows.length}`}
            />
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div
          style={modalBackdrop}
          onClick={() => !siBusy && closeModal()}
          onKeyDown={(e) => e.key === "Escape" && !siBusy && closeModal()}
          role="presentation"
        >
          <div
            style={modalPanel}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.05rem" }}>
              {editingId ? "Edit static JSON source" : "New static JSON source"}
            </h2>
            <div style={formGrid}>
              <label style={lblRow}>
                <span style={lblRowLabel}>Ingestion name</span>
                <input
                  value={siName}
                  onChange={(e) => setSiName(e.target.value)}
                  style={{ ...inp, ...inpGrow }}
                  disabled={siBusy}
                />
              </label>
              <label style={{ ...lblRow, alignItems: "flex-start" }}>
                <span style={{ ...lblRowLabel, paddingTop: "0.35rem" }}>Description</span>
                <textarea
                  value={siDesc}
                  onChange={(e) => setSiDesc(e.target.value)}
                  rows={2}
                  style={{ ...inp, ...inpGrow, resize: "vertical" }}
                  disabled={siBusy}
                />
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
                <select
                  value={siScheduleKind}
                  onChange={(e) => onScheduleKindChange(e.target.value)}
                  style={{ ...inp, ...inpGrow }}
                  disabled={siBusy}
                >
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
              {siScheduleKind === "daily" || siScheduleKind === "alternate_days" ? (
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
                <textarea
                  value={siPayloadText}
                  onChange={(e) => setSiPayloadText(e.target.value)}
                  rows={8}
                  style={{ ...inp, ...inpGrow, fontFamily: "monospace", fontSize: "0.78rem", minHeight: "10rem" }}
                  disabled={siBusy}
                />
              </label>
              <label style={lblRow}>
                <span style={lblRowLabel}>Load from file</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => onPayloadFile(e.target.files?.[0] ?? null)}
                  disabled={siBusy}
                  style={inpGrow}
                />
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
              <AppButton type="button" variant="secondary" disabled={siBusy} onClick={() => void onValidateStatic()}>
                Validate
              </AppButton>
              <AppButton type="button" variant="primary" disabled={siBusy} onClick={() => void onSaveStatic()}>
                Save
              </AppButton>
              <AppButton type="button" variant="ghost" disabled={siBusy} onClick={closeModal}>
                Cancel
              </AppButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const modalBackdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: "1rem",
};

const modalPanel: CSSProperties = {
  background: "var(--color-surface-elevated)",
  color: "var(--color-text)",
  borderRadius: "var(--radius)",
  maxWidth: "min(920px, 100%)",
  width: "100%",
  maxHeight: "min(92vh, 900px)",
  overflow: "auto",
  padding: "1rem",
  border: "1px solid var(--color-border)",
};

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
