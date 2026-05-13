import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "@/api/client";
import {
  addSiteMember,
  listRolesCatalog,
  listSiteMembers,
  patchSiteMemberRole,
  removeSiteMember,
  SITE_ROLE_KEYS,
  type RoleCatalogItem,
  type SiteMemberRow,
} from "@/api/siteAccess";
import { AppModalShell } from "@/components/app/AppModalShell";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";
import { useSitePermissions } from "@/contexts/SitePermissionsContext";
import "./device-register-page.css";

type SiteOpt = { id: string; name: string; description: string | null };

const PAGE_SIZE = 25;

const SITE_ROLE_INTENTS: readonly { role: string; intent: string }[] = [
  {
    role: "site_admin",
    intent: "Full site administration: members, devices, dashboards, and related settings at this site.",
  },
  {
    role: "developer",
    intent: "Endpoints, scrubbers, workflows, and integrations for this site.",
  },
  {
    role: "device_operator",
    intent: "Day-to-day devices, operational footprint, and OTA visibility at this site.",
  },
  {
    role: "device_viewer",
    intent: "Read-only access to devices and status at this site.",
  },
  {
    role: "dashboard_viewer",
    intent: "View dashboards only at this site.",
  },
];

function SiteRoleDescriptionsTable() {
  return (
    <div className="site-access-role-descriptions" aria-label="Site role descriptions">
      <table className="site-access-role-descriptions__table">
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Typical intent</th>
          </tr>
        </thead>
        <tbody>
          {SITE_ROLE_INTENTS.map((row) => (
            <tr key={row.role}>
              <td>{row.role}</td>
              <td>{row.intent}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SiteRoleFieldWithHelp({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <span className="admin-modal-form__field-title admin-modal-form__field-title--block">{title}</span>
      <SiteRoleDescriptionsTable />
      {children}
    </>
  );
}

export function SiteAccessPage() {
  const { hasSite, refresh: refreshPerms } = useSitePermissions();
  const [sites, setSites] = useState<SiteOpt[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [rows, setRows] = useState<SiteMemberRow[]>([]);
  const [roles, setRoles] = useState<RoleCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<SiteMemberRow | null>(null);
  const [drawerRole, setDrawerRole] = useState("");
  const [drawerErr, setDrawerErr] = useState<string | null>(null);
  const [emailContains, setEmailContains] = useState("");
  const [nameContains, setNameContains] = useState("");
  const [page, setPage] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("device_operator");

  const loadSites = useCallback(async () => {
    try {
      const data = await apiFetch<SiteOpt[]>("/administration/sites");
      setSites(data ?? []);
      setSiteId((prev) => {
        if (prev && data?.some((s) => s.id === prev)) return prev;
        return data?.[0]?.id ?? "";
      });
    } catch {
      setSites([]);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    if (!siteId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await listSiteMembers(siteId);
      setRows(res?.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load site members");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  const loadRoles = useCallback(async () => {
    try {
      const r = await listRolesCatalog();
      setRoles(r ?? []);
    } catch {
      setRoles([]);
    }
  }, []);

  useEffect(() => {
    void loadSites();
    void loadRoles();
  }, [loadSites, loadRoles]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const siteRoles = useMemo(
    () => roles.filter((r) => (SITE_ROLE_KEYS as readonly string[]).includes(r.role_key)),
    [roles],
  );

  useEffect(() => {
    if (siteRoles.length && !siteRoles.some((r) => r.role_key === addRole)) {
      setAddRole(siteRoles[0].role_key);
    }
  }, [siteRoles, addRole]);

  const filtered = useMemo(() => {
    const ec = emailContains.trim().toLowerCase();
    const nc = nameContains.trim().toLowerCase();
    return rows.filter((r) => {
      if (ec && !r.email.toLowerCase().includes(ec)) return false;
      if (nc) {
        const fn = (r.full_name || "").toLowerCase();
        if (!fn.includes(nc)) return false;
      }
      return true;
    });
  }, [rows, emailContains, nameContains]);

  const kpis = useMemo(() => {
    let invited = 0;
    let active = 0;
    let disabled = 0;
    for (const r of filtered) {
      if (r.status === "invited") invited += 1;
      else if (r.status === "active") active += 1;
      else if (r.status === "disabled") disabled += 1;
    }
    return { total: filtered.length, invited, active, disabled };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [emailContains, nameContains, siteId, rows.length]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  const rolePreview = useMemo(() => {
    const r = siteRoles.find((x) => x.role_key === drawerRole);
    return r?.permission_keys ?? [];
  }, [siteRoles, drawerRole]);

  const canRead = Boolean(siteId && hasSite("users.read"));
  const canInvite = Boolean(siteId && hasSite("users.invite"));
  const canAssign = Boolean(siteId && hasSite("users.assign_roles"));

  function openAddModal() {
    setAddErr(null);
    setAddEmail("");
    setAddRole(siteRoles[0]?.role_key ?? "device_operator");
    setAddOpen(true);
  }

  async function onAddMember(e: FormEvent) {
    e.preventDefault();
    if (!siteId) return;
    setAddErr(null);
    try {
      await addSiteMember(siteId, { email: addEmail.trim(), role: addRole });
      setAddOpen(false);
      await loadUsers();
      await refreshPerms();
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : "Add failed");
    }
  }

  return (
    <PageShell variant="list" className="site-access-page device-manage-page">
      <div className="dm-root">
        <header className="dm-page-hero">
          <div className="dm-page-hero__top">
            <div className="dm-page-hero__titles">
              <h1 className="dm-sr-only">Site access</h1>
              <p className="dm-page-hero__subtitle" style={{ marginTop: 0 }}>
                Manage site membership and roles. Permissions are enforced on every API call.
              </p>
            </div>
          </div>
        </header>

        {err ? (
          <PageStatus variant="error">
            <p>{err}</p>
            {err.includes("No response") || err.includes("NetworkError") || err.includes("Failed to fetch") ? (
              <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.85rem" }}>
                The UI could not reach the API. From the repo root start the stack (for example{" "}
                <code style={{ color: "var(--color-accent)" }}>docker compose up -d api</code> or{" "}
                <code style={{ color: "var(--color-accent)" }}>./run.sh up</code>
                ), confirm something is listening on port <strong>8000</strong>, and that{" "}
                <code style={{ color: "var(--color-accent)" }}>VITE_API_BASE_URL</code> matches how you open the app (
                <code style={{ color: "var(--color-accent)" }}>http://localhost:8000/api/v1</code> when using defaults).
              </p>
            ) : null}
          </PageStatus>
        ) : null}

        {!canRead && siteId ? (
          <PageStatus variant="warning">You do not have users.read on this site.</PageStatus>
        ) : null}

        {canRead ? (
          <>
            <section className="dm-kpi-row dm-kpi-row--equal-4" aria-label="Member summary">
              <div className="dm-kpi">
                <div className="dm-kpi__body">
                  <div className="dm-kpi__label">Matching</div>
                  <div className="dm-kpi__value">{kpis.total}</div>
                  <div className="dm-kpi__sub">After text filters</div>
                </div>
              </div>
              <div className="dm-kpi">
                <div className="dm-kpi__body">
                  <div className="dm-kpi__label">Invited</div>
                  <div className="dm-kpi__value">{kpis.invited}</div>
                  <div className="dm-kpi__sub">status = invited</div>
                </div>
              </div>
              <div className="dm-kpi">
                <div className="dm-kpi__body">
                  <div className="dm-kpi__label">Active</div>
                  <div className="dm-kpi__value">{kpis.active}</div>
                  <div className="dm-kpi__sub">status = active</div>
                </div>
              </div>
              <div className="dm-kpi">
                <div className="dm-kpi__body">
                  <div className="dm-kpi__label">Disabled</div>
                  <div className="dm-kpi__value">{kpis.disabled}</div>
                  <div className="dm-kpi__sub">status = disabled</div>
                </div>
              </div>
            </section>

            <section className="dm-filter-panel" aria-label="Site, filters, and add member">
              {canInvite ? (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.35rem" }}>
                  <button type="button" className="dm-btn dm-btn--primary" onClick={openAddModal} disabled={!siteId}>
                    Add member
                  </button>
                </div>
              ) : null}
              <div className="dm-controls-form__row">
                <label className="dm-filter-field">
                  <span className="dm-filter-field__label">Site</span>
                  <select
                    id="site-access-site"
                    value={siteId}
                    onChange={(e) => setSiteId(e.target.value)}
                    aria-label="Site"
                  >
                    {sites.length === 0 ? <option value="">No sites</option> : null}
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="dm-filter-field dm-filter-field--grow">
                  <span className="dm-filter-field__label">Email contains</span>
                  <input
                    type="text"
                    value={emailContains}
                    onChange={(e) => setEmailContains(e.target.value)}
                    placeholder="Substring match on email…"
                  />
                </label>
                <label className="dm-filter-field dm-filter-field--grow">
                  <span className="dm-filter-field__label">Display name contains</span>
                  <input
                    type="text"
                    value={nameContains}
                    onChange={(e) => setNameContains(e.target.value)}
                    placeholder="Match full_name…"
                  />
                </label>
              </div>
            </section>

            <AppModalShell
              open={addOpen}
              onClose={() => setAddOpen(false)}
              title="Add member"
              subtitle="Add an existing tenant user by email, or invite a new address for this site."
              size="md"
              dialogClassName="admin-modal--form site-access-modal-dialog"
            >
              <form className="admin-modal-form" onSubmit={onAddMember}>
                {addErr ? (
                  <p className="admin-modal-form__err" role="alert">
                    {addErr}
                  </p>
                ) : null}
                <label className="admin-modal-form__field">
                  <span>Email</span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    placeholder="user@example.com"
                  />
                </label>
                <label className="admin-modal-form__field">
                  <SiteRoleFieldWithHelp title="Site role">
                    <select value={addRole} onChange={(e) => setAddRole(e.target.value)}>
                      {siteRoles.map((r) => (
                        <option key={r.id} value={r.role_key}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </SiteRoleFieldWithHelp>
                </label>
                <div className="admin-modal-form__actions">
                  <button type="button" className="dm-btn dm-btn--secondary" onClick={() => setAddOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="dm-btn dm-btn--primary" disabled={!siteId}>
                    Add to site
                  </button>
                </div>
              </form>
            </AppModalShell>

            <AppModalShell
              open={drawer != null}
              onClose={() => setDrawer(null)}
              title="Site role"
              subtitle={drawer ? `${drawer.full_name || "—"} · ${drawer.email}` : undefined}
              size="md"
              dialogClassName="admin-modal--form site-access-modal-dialog"
            >
              {drawer ? (
                <div className="admin-modal-form">
                  <p className="admin-modal-form__hint" style={{ marginTop: 0 }}>
                    Site: <strong>{sites.find((s) => s.id === siteId)?.name ?? siteId}</strong>
                  </p>
                  {drawerErr ? (
                    <p className="admin-modal-form__err" role="alert">
                      {drawerErr}
                    </p>
                  ) : null}
                  <label className="admin-modal-form__field">
                    <SiteRoleFieldWithHelp title="Role">
                      <select value={drawerRole} onChange={(e) => setDrawerRole(e.target.value)}>
                        {siteRoles.map((r) => (
                          <option key={r.id} value={r.role_key}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </SiteRoleFieldWithHelp>
                  </label>
                  <fieldset className="admin-modal-form__fieldset">
                    <legend>Effective permissions</legend>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: "1.1rem",
                        maxHeight: "200px",
                        overflow: "auto",
                        fontSize: "0.9rem",
                      }}
                    >
                      {rolePreview.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </fieldset>
                  <div className="admin-modal-form__actions">
                    <button
                      type="button"
                      className="dm-btn dm-btn--danger"
                      disabled={!canAssign}
                      onClick={async () => {
                        if (!drawer || !siteId) return;
                        setDrawerErr(null);
                        try {
                          await removeSiteMember(siteId, drawer.user_id);
                          setDrawer(null);
                          await loadUsers();
                          await refreshPerms();
                        } catch (e) {
                          setDrawerErr(e instanceof Error ? e.message : "Remove failed");
                        }
                      }}
                    >
                      Remove from site
                    </button>
                    <button type="button" className="dm-btn dm-btn--secondary" onClick={() => setDrawer(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="dm-btn dm-btn--primary"
                      disabled={!canAssign}
                      onClick={async () => {
                        if (!drawer || !siteId) return;
                        setDrawerErr(null);
                        try {
                          await patchSiteMemberRole(siteId, drawer.user_id, { role: drawerRole });
                          setDrawer(null);
                          await loadUsers();
                          await refreshPerms();
                        } catch (e) {
                          setDrawerErr(e instanceof Error ? e.message : "Save failed");
                        }
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : null}
            </AppModalShell>

            <div className="dm-table-wrap">
              {!siteId ? (
                <p className="dm-empty">Select a site or create one under Administration.</p>
              ) : loading && rows.length === 0 ? (
                <p className="dm-empty">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="dm-empty">
                  {loading && rows.length > 0 ? "Updating list…" : "No members match the current filters."}
                </p>
              ) : (
                <div className="dm-device-table-shell" aria-busy={loading}>
                  {loading && rows.length > 0 ? <p className="dm-table-loading">Updating list…</p> : null}
                  <table className="dm-data-table">
                    <thead>
                      <tr>
                        <th className="dm-data-table__th" scope="col">
                          Email
                        </th>
                        <th className="dm-data-table__th" scope="col">
                          Display name
                        </th>
                        <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                          Role
                        </th>
                        <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                          Status
                        </th>
                        <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                          Sites
                        </th>
                        <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                          Last login
                        </th>
                        {canAssign ? (
                          <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                            Actions
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((r) => (
                        <tr key={r.user_id} className="dm-data-table__row">
                          <td className="dm-data-table__td">
                            <strong>{r.email}</strong>
                          </td>
                          <td className="dm-data-table__td">{r.full_name || "—"}</td>
                          <td className="dm-data-table__td dm-data-table__td--center">
                            {r.role_name || r.role_key || "—"}
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--center">{r.status}</td>
                          <td className="dm-data-table__td dm-data-table__td--center dm-data-table__td--muted">
                            <small>{r.sites_count}</small>
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--center dm-data-table__td--muted">
                            <small>{r.last_login_at ? r.last_login_at : "—"}</small>
                          </td>
                          {canAssign ? (
                            <td className="dm-data-table__td dm-data-table__td--center">
                              <button
                                type="button"
                                className="dm-act-grid__btn dm-act-grid__btn--text"
                                onClick={() => {
                                  setDrawer(r);
                                  setDrawerRole(r.role_key || "device_operator");
                                  setDrawerErr(null);
                                }}
                              >
                                Role…
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {siteId && filtered.length > 0 ? (
                <div className="dm-table-pager" role="navigation" aria-label="Pagination">
                  <span className="dm-table-pager__meta">
                    {filtered.length === 0
                      ? "0 members"
                      : `Showing ${safePage * PAGE_SIZE + 1}–${Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} of ${filtered.length}`}
                  </span>
                  <div className="dm-table-pager__controls">
                    <button
                      type="button"
                      className="dm-act-grid__btn dm-act-grid__btn--text"
                      disabled={safePage <= 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      <ChevronLeft size={16} aria-hidden />
                      Prev
                    </button>
                    <span className="dm-table-pager__page">
                      Page {safePage + 1} / {pageCount}
                    </span>
                    <button
                      type="button"
                      className="dm-act-grid__btn dm-act-grid__btn--text"
                      disabled={safePage >= pageCount - 1}
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    >
                      Next
                      <ChevronRight size={16} aria-hidden />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
