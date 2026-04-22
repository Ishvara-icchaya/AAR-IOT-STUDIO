import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatRelativeAgo } from "@/lib/formatRelativeAgo";
import type { OpsDeviceRow } from "./operationsOverviewModel";

const PAGE = 5;

type Props = {
  title: string;
  viewAllTo?: string;
  rows: OpsDeviceRow[];
};

function statusPillClass(status: string | undefined): string {
  const s = (status || "").toLowerCase();
  if (s === "online") return "ops-pill ops-pill--online";
  if (s === "offline") return "ops-pill ops-pill--offline";
  if (s === "late" || s.includes("wait")) return "ops-pill ops-pill--degraded";
  return "ops-pill ops-pill--muted";
}

function statusDotClass(status: string | undefined): string {
  const s = (status || "").toLowerCase();
  if (s === "online") return "ops-mini-dot ops-mini-dot--online";
  if (s === "offline") return "ops-mini-dot ops-mini-dot--offline";
  if (s === "late" || s.includes("wait")) return "ops-mini-dot ops-mini-dot--warn";
  return "ops-mini-dot ops-mini-dot--muted";
}

export function OverviewStatusTableCard({ title, viewAllTo, rows }: Props) {
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [rows.length, title]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE));
  const safePage = Math.min(page, totalPages);
  const slice = useMemo(() => {
    const p0 = (safePage - 1) * PAGE;
    return rows.slice(p0, p0 + PAGE);
  }, [rows, safePage]);

  const showNav = rows.length > PAGE;

  return (
    <article className="ops-card ops-card--table">
      <header className="ops-card__head">
        <h2 className="ops-card__title">{title}</h2>
        {viewAllTo ? (
          <div className="ops-card__actions">
            <Link className="ops-card__link" to={viewAllTo}>
              View all
            </Link>
          </div>
        ) : null}
      </header>
      <div className="ops-card__body">
        {rows.length === 0 ? (
          <p className="ops-overview-empty">No devices in scope</p>
        ) : (
          <>
            <div className="ops-mini-table-wrap">
              <table className="ops-mini-table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Site</th>
                    <th>Status</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((r, i) => (
                    <tr key={`${(safePage - 1) * PAGE + i}-${r.device_name ?? ""}`}>
                      <td>
                        <span className={statusDotClass(r.status)} aria-hidden />
                        {r.device_name ?? "—"}
                      </td>
                      <td>{r.site_name ?? "—"}</td>
                      <td>
                        <span className={statusPillClass(r.status)}>{formatStatus(r.status)}</span>
                      </td>
                      <td>{formatRelativeAgo(r.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {showNav ? (
              <div className="ops-list-footer ops-list-footer--minimal">
                <div className="ops-list-footer__nav">
                  <button
                    type="button"
                    className="ops-list-footer__btn"
                    aria-label="Previous page"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="ops-list-footer__btn"
                    aria-label="Next page"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    ›
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}

function formatStatus(s: string | undefined): string {
  if (!s) return "—";
  return s.replace(/_/g, " ");
}
