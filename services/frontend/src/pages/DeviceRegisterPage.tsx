import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/api/client";
import { createDevice, listDevices, updateDevice, type DeviceRead } from "@/api/devices";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type SiteRow = { id: string; name: string };

type ModalMode = "create" | "edit" | null;

export function DeviceRegisterPage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [sitesById, setSitesById] = useState<Record<string, string>>({});
  const [items, setItems] = useState<DeviceRead[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [siteId, setSiteId] = useState("");

  const loadSites = useCallback(async () => {
    try {
      const data = await apiFetch<SiteRow[]>("/administration/sites");
      setSites(data ?? []);
      const map: Record<string, string> = {};
      for (const s of data ?? []) map[s.id] = s.name;
      setSitesById(map);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load sites");
    }
  }, []);

  const loadDevices = useCallback(async (q: string) => {
    setTableLoading(true);
    setErr(null);
    try {
      const list = await listDevices(q.trim() ? { q: q.trim() } : undefined);
      setItems(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load devices");
    } finally {
      setTableLoading(false);
      setLoading(false);
    }
  }, []);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditId(null);
    setSaving(false);
  }, []);

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  useEffect(() => {
    void loadDevices(appliedQ);
  }, [appliedQ, loadDevices]);

  useEffect(() => {
    if (modalMode !== "create" && modalMode !== "edit") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalMode, closeModal]);

  useEffect(() => {
    if (modalMode === "create" && !siteId && sites.length > 0) {
      setSiteId(sites[0].id);
    }
  }, [modalMode, siteId, sites]);

  function openCreateModal() {
    setErr(null);
    setOk(null);
    setEditId(null);
    setName("");
    setDescription("");
    setSiteId(sites[0]?.id ?? "");
    setModalMode("create");
  }

  function openEditModal(d: DeviceRead) {
    setErr(null);
    setOk(null);
    setEditId(d.id);
    setName(d.name);
    setDescription(d.description ?? "");
    setSiteId(d.site_id);
    setModalMode("edit");
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setAppliedQ(searchInput);
  }

  async function onModalSubmit(e: FormEvent) {
    e.preventDefault();
    if (!siteId || !name.trim()) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      if (modalMode === "create") {
        await createDevice({
          name: name.trim(),
          description: description.trim() || null,
          site_id: siteId,
        });
        setOk("Device registered.");
      } else if (modalMode === "edit" && editId) {
        await updateDevice(editId, {
          name: name.trim(),
          description: description.trim() || null,
          site_id: siteId,
        });
        setOk("Device updated.");
      }
      closeModal();
      await loadDevices(appliedQ);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell title="Register Devices">
      <div style={stack}>
        <p style={lead}>Search registered devices by name or description, or add a new device for a site.</p>

        {err ? <PageStatus variant="error">{err}</PageStatus> : null}
        {ok ? <PageStatus variant="success">{ok}</PageStatus> : null}

        <form onSubmit={onSearch} style={toolbar}>
          <label style={searchLbl}>
            Search
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Name or description"
              style={searchInp}
            />
          </label>
          <button type="submit" style={btnSecondary} disabled={tableLoading}>
            Search
          </button>
          <button type="button" style={btnPrimary} onClick={openCreateModal}>
            Register new device
          </button>
        </form>

        <div style={tableWrap}>
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Site</th>
                <th style={th}>Description</th>
                <th style={th} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={4} style={tdEmpty}>
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} style={tdEmpty}>
                    No devices match{appliedQ ? ` “${appliedQ}”` : ""}.{" "}
                    <button type="button" style={linkBtn} onClick={openCreateModal}>
                      Register one
                    </button>
                  </td>
                </tr>
              ) : (
                items.map((d) => (
                  <tr key={d.id}>
                    <td style={td}>{d.name}</td>
                    <td style={td}>
                      <small>{sitesById[d.site_id] ?? d.site_id.slice(0, 8) + "…"}</small>
                    </td>
                    <td style={tdDesc}>
                      <span title={d.description ?? undefined}>{d.description?.trim() ? d.description : "—"}</span>
                    </td>
                    <td style={tdAct}>
                      <button
                        type="button"
                        style={iconBtn}
                        title="Edit device"
                        aria-label={`Edit ${d.name}`}
                        onClick={() => openEditModal(d)}
                      >
                        <EditIcon />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalMode ? (
        <div style={modalBackdrop} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
          <div style={modalDialog} role="dialog" aria-modal="true" aria-labelledby="device-modal-title">
            <h2 id="device-modal-title" style={modalTitle}>
              {modalMode === "create" ? "Register device" : "Edit device"}
            </h2>
            <form onSubmit={onModalSubmit}>
              <div style={modalRow}>
                <label style={modalField}>
                  Site
                  <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required style={inp}>
                    <option value="" disabled>
                      Select site
                    </option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={modalField}>
                  Device name
                  <input value={name} onChange={(e) => setName(e.target.value)} required style={inp} />
                </label>
                <label style={modalField}>
                  Description
                  <input value={description} onChange={(e) => setDescription(e.target.value)} style={inp} />
                </label>
                <button type="submit" style={btnPrimary} disabled={saving || !sites.length}>
                  {saving ? "Saving…" : modalMode === "create" ? "Register device" : "Save changes"}
                </button>
              </div>
              <div style={modalFooter}>
                <button type="button" style={btnSecondary} onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

function EditIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

const stack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
  minHeight: 0,
};

const lead: CSSProperties = {
  margin: 0,
  fontSize: "0.9rem",
  color: "var(--color-text-muted)",
  maxWidth: "42rem",
};

const toolbar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.65rem",
  alignItems: "flex-end",
};

const searchLbl: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.2rem",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  flex: "0 1 auto",
  width: "min(220px, 100%)",
  maxWidth: "220px",
};

const searchInp: CSSProperties = {
  padding: "0.3rem 0.4rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
  fontSize: "0.8rem",
  width: "100%",
  maxWidth: "220px",
  boxSizing: "border-box",
};

const inp: CSSProperties = {
  padding: "0.45rem 0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
  fontSize: "0.88rem",
};

const btnPrimary: CSSProperties = {
  padding: "0.5rem 0.85rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "#fff",
  fontFamily: "inherit",
  fontWeight: 600,
  fontSize: "0.88rem",
  cursor: "pointer",
};

const btnSecondary: CSSProperties = {
  padding: "0.5rem 0.85rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text)",
  fontFamily: "inherit",
  fontWeight: 600,
  fontSize: "0.88rem",
  cursor: "pointer",
};

const tableWrap: CSSProperties = {
  overflow: "auto",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  flex: 1,
  minHeight: 0,
};

const tbl: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.88rem",
};

const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.65rem",
  borderBottom: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text-muted)",
  fontWeight: 600,
};

const td: CSSProperties = {
  padding: "0.45rem 0.65rem",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "top",
};

const tdDesc: CSSProperties = {
  ...td,
  maxWidth: "320px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const tdAct: CSSProperties = {
  ...td,
  width: "3rem",
  textAlign: "right",
};

const tdEmpty: CSSProperties = {
  ...td,
  color: "var(--color-text-muted)",
  padding: "1.25rem",
};

const iconBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0.35rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  cursor: "pointer",
};

const linkBtn: CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  color: "var(--color-accent)",
  cursor: "pointer",
  font: "inherit",
  textDecoration: "underline",
};

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

const modalDialog: CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "12px",
  padding: "1.25rem 1.5rem",
  maxWidth: "min(960px, 100%)",
  width: "100%",
  boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
};

const modalTitle: CSSProperties = {
  margin: "0 0 1rem",
  fontSize: "1.1rem",
  fontWeight: 600,
};

const modalRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.65rem",
  alignItems: "flex-end",
};

const modalField: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.8rem",
  color: "var(--color-text-muted)",
  flex: "1 1 140px",
  minWidth: "120px",
};

const modalFooter: CSSProperties = {
  marginTop: "1rem",
  display: "flex",
  justifyContent: "flex-end",
  gap: "0.5rem",
};
