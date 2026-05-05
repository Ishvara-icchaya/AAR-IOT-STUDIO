import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "@/api/client";
import { AppModalShell } from "@/components/app/AppModalShell";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";
import "./device-register-page.css";

type SiteRow = { id: string; name: string; description: string | null };

const PAGE_SIZE = 25;

export function AdminSitesPage() {
  const [items, setItems] = useState<SiteRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameContains, setNameContains] = useState("");
  const [descContains, setDescContains] = useState("");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiFetch<SiteRow[]>("/administration/sites");
      setItems(data ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load sites");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const nc = nameContains.trim().toLowerCase();
    const dc = descContains.trim().toLowerCase();
    return items.filter((s) => {
      if (nc && !s.name.toLowerCase().includes(nc)) return false;
      if (dc) {
        const d = (s.description || "").toLowerCase();
        if (!d.includes(dc)) return false;
      }
      return true;
    });
  }, [items, nameContains, descContains]);

  const kpis = useMemo(() => {
    const total = filtered.length;
    const withDesc = filtered.filter((s) => !!(s.description && s.description.trim())).length;
    return { total, withDesc };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [nameContains, descContains, items.length]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  function openCreateModal() {
    setCreateErr(null);
    setName("");
    setDescription("");
    setCreateOpen(true);
  }

  async function onCreateSite(e: FormEvent) {
    e.preventDefault();
    setCreateErr(null);
    try {
      await apiFetch("/administration/sites", {
        method: "POST",
        json: { name: name.trim(), description: description.trim() || null },
      });
      setCreateOpen(false);
      await load();
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "Create failed (admin only)");
    }
  }

  return (
    <PageShell variant="list" className="admin-sites-page device-manage-page">
      <div className="dm-root">
        <header className="dm-page-hero">
          <div className="dm-page-hero__top">
            <div className="dm-page-hero__titles">
              <h1 className="dm-sr-only">Sites</h1>
              <p className="dm-page-hero__subtitle" style={{ marginTop: 0 }}>
                Create and review site records used across the platform.
              </p>
            </div>
          </div>
        </header>

        {err ? <PageStatus variant="error">{err}</PageStatus> : null}

        <section className="dm-kpi-row dm-kpi-row--equal-2" aria-label="Site summary">
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Matching</div>
              <div className="dm-kpi__value">{kpis.total}</div>
              <div className="dm-kpi__sub">After name / description filters</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">With description</div>
              <div className="dm-kpi__value">{kpis.withDesc}</div>
              <div className="dm-kpi__sub">Non-empty description</div>
            </div>
          </div>
        </section>

        <section className="dm-filter-panel" aria-label="Filters and create site">
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.35rem" }}>
            <button type="button" className="dm-btn dm-btn--primary" onClick={openCreateModal}>
              Create site
            </button>
          </div>
          <div className="dm-controls-form__row">
            <label className="dm-filter-field dm-filter-field--grow">
              <span className="dm-filter-field__label">Name contains</span>
              <input
                type="text"
                value={nameContains}
                onChange={(e) => setNameContains(e.target.value)}
                placeholder="Substring on site name…"
              />
            </label>
            <label className="dm-filter-field dm-filter-field--grow">
              <span className="dm-filter-field__label">Description contains</span>
              <input
                type="text"
                value={descContains}
                onChange={(e) => setDescContains(e.target.value)}
                placeholder="Substring on description…"
              />
            </label>
          </div>
        </section>

        <AppModalShell
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title="Create site"
          subtitle="New site for this tenant."
          size="xl"
          dialogClassName="scrubber-raw-select-modal admin-modal--form admin-modal--narrow"
        >
          <form className="admin-modal-form" onSubmit={onCreateSite}>
            {createErr ? (
              <p className="admin-modal-form__err" role="alert">
                {createErr}
              </p>
            ) : null}
            <label className="admin-modal-form__field">
              <span>Site name</span>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Site name" />
            </label>
            <label className="admin-modal-form__field">
              <span>Description</span>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description for operators"
                style={{ resize: "vertical", minHeight: "5rem" }}
              />
            </label>
            <div className="admin-modal-form__actions">
              <button type="button" className="dm-btn dm-btn--secondary" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="dm-btn dm-btn--primary">
                Create site
              </button>
            </div>
          </form>
        </AppModalShell>

        <div className="dm-table-wrap">
          {loading && items.length === 0 ? (
            <p className="dm-empty">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="dm-empty">
              {loading && items.length > 0 ? "Updating list…" : "No sites match the current filters."}
            </p>
          ) : (
            <div className="dm-device-table-shell" aria-busy={loading}>
              {loading && items.length > 0 ? <p className="dm-table-loading">Updating list…</p> : null}
              <table className="dm-data-table">
                <thead>
                  <tr>
                    <th className="dm-data-table__th" scope="col">
                      Name
                    </th>
                    <th className="dm-data-table__th dm-data-table__th--desc" scope="col">
                      Description
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Id
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((s) => (
                    <tr key={s.id} className="dm-data-table__row">
                      <td className="dm-data-table__td">
                        <strong>{s.name}</strong>
                      </td>
                      <td className="dm-data-table__td dm-data-table__td--desc">
                        <span title={s.description ?? undefined}>
                          {s.description?.trim() ? s.description : "—"}
                        </span>
                      </td>
                      <td className="dm-data-table__td dm-data-table__td--muted">
                        <code style={{ fontSize: "0.72rem" }}>{s.id.length > 12 ? `${s.id.slice(0, 12)}…` : s.id}</code>
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
                ? "0 sites"
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
