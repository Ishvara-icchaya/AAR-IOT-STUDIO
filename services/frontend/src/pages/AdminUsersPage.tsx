import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "@/api/client";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";
import "./device-register-page.css";

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  site_ids: string[];
};

const PAGE_SIZE = 25;

export function AdminUsersPage() {
  const [items, setItems] = useState<UserRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "operator">("operator");
  const [emailContains, setEmailContains] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "operator">("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "yes" | "no">("all");
  const [nameContains, setNameContains] = useState("");
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiFetch<UserRow[]>("/administration/users");
      setItems(data ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load users");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const ec = emailContains.trim().toLowerCase();
    const nc = nameContains.trim().toLowerCase();
    return items.filter((r) => {
      if (ec && !r.email.toLowerCase().includes(ec)) return false;
      if (nc) {
        const fn = (r.full_name || "").toLowerCase();
        if (!fn.includes(nc)) return false;
      }
      if (roleFilter !== "all" && (r.role || "").toLowerCase() !== roleFilter) return false;
      if (activeFilter === "yes" && !r.is_active) return false;
      if (activeFilter === "no" && r.is_active) return false;
      return true;
    });
  }, [items, emailContains, nameContains, roleFilter, activeFilter]);

  const kpis = useMemo(() => {
    const total = filtered.length;
    let admins = 0;
    let operators = 0;
    let active = 0;
    for (const r of filtered) {
      if ((r.role || "").toLowerCase() === "admin") admins += 1;
      if ((r.role || "").toLowerCase() === "operator") operators += 1;
      if (r.is_active) active += 1;
    }
    return { total, admins, operators, active };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [emailContains, nameContains, roleFilter, activeFilter, items.length]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await apiFetch("/administration/users", {
        method: "POST",
        json: { email, password, role, site_ids: [] },
      });
      setEmail("");
      setPassword("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    }
  }

  return (
    <PageShell variant="list" className="admin-users-page device-manage-page">
      <div className="dm-root">
        <header className="dm-page-hero">
          <div className="dm-page-hero__top">
            <div className="dm-page-hero__titles">
              <h1 className="dm-sr-only">Users</h1>
              <p className="dm-page-hero__subtitle" style={{ marginTop: 0 }}>
                Inspect accounts and create platform users.
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

        <section className="dm-kpi-row dm-kpi-row--equal-4" aria-label="User summary">
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Matching</div>
              <div className="dm-kpi__value">{kpis.total}</div>
              <div className="dm-kpi__sub">After text filters</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Admins</div>
              <div className="dm-kpi__value">{kpis.admins}</div>
              <div className="dm-kpi__sub">role = admin</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Operators</div>
              <div className="dm-kpi__value">{kpis.operators}</div>
              <div className="dm-kpi__sub">role = operator</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Active</div>
              <div className="dm-kpi__value">{kpis.active}</div>
              <div className="dm-kpi__sub">is_active in list</div>
            </div>
          </div>
        </section>

        <section className="dm-filter-panel" aria-label="Filters and create user">
          <div className="dm-controls-form__row">
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
            <label className="dm-filter-field">
              <span className="dm-filter-field__label">Role</span>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}>
                <option value="all">All</option>
                <option value="admin">admin</option>
                <option value="operator">operator</option>
              </select>
            </label>
            <label className="dm-filter-field">
              <span className="dm-filter-field__label">Active</span>
              <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}>
                <option value="all">All</option>
                <option value="yes">Active only</option>
                <option value="no">Inactive only</option>
              </select>
            </label>
          </div>
          <form className="dm-controls-form__row" style={{ marginTop: "0.55rem" }} onSubmit={onCreate}>
            <label className="dm-filter-field dm-filter-field--grow">
              <span className="dm-filter-field__label">New email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </label>
            <label className="dm-filter-field dm-filter-field--grow">
              <span className="dm-filter-field__label">Password (min 8)</span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </label>
            <label className="dm-filter-field">
              <span className="dm-filter-field__label">Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "operator")}>
                <option value="operator">operator</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <button type="submit" className="dm-btn dm-btn--primary" style={{ marginBottom: "0.12rem" }}>
              Create user
            </button>
          </form>
        </section>

        <div className="dm-table-wrap">
          {loading && items.length === 0 ? (
            <p className="dm-empty">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="dm-empty">
              {loading && items.length > 0 ? "Updating list…" : "No users match the current filters."}
            </p>
          ) : (
            <div className="dm-device-table-shell" aria-busy={loading}>
              {loading && items.length > 0 ? <p className="dm-table-loading">Updating list…</p> : null}
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
                      Active
                    </th>
                    <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                      Sites
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((r) => (
                    <tr key={r.id} className="dm-data-table__row">
                      <td className="dm-data-table__td">
                        <strong>{r.email}</strong>
                      </td>
                      <td className="dm-data-table__td">{r.full_name || "—"}</td>
                      <td className="dm-data-table__td dm-data-table__td--center">{r.role}</td>
                      <td className="dm-data-table__td dm-data-table__td--center">{r.is_active ? "Yes" : "No"}</td>
                      <td className="dm-data-table__td dm-data-table__td--center dm-data-table__td--muted">
                        <small>
                          {r.site_ids?.length
                            ? `${r.site_ids.length} id${r.site_ids.length === 1 ? "" : "s"}`
                            : "—"}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="dm-table-pager" role="navigation" aria-label="Pagination">
            <span className="dm-table-pager__meta">
              {filtered.length === 0
                ? "0 users"
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
        </div>
      </div>
    </PageShell>
  );
}
