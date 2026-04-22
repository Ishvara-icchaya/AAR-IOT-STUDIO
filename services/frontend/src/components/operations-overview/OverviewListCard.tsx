import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

const PAGE = 4;

export type OverviewListRow = {
  key: string;
  main: ReactNode;
  meta?: string;
  ts: string;
  /** Left severity accent for alerts */
  sevTone?: "crit" | "warn" | "muted";
};

type Props = {
  title: string;
  viewAllTo?: string;
  viewAllLabel?: string;
  emptyText: string;
  rows: OverviewListRow[];
};

export function OverviewListCard({ title, viewAllTo, viewAllLabel = "View all", emptyText, rows }: Props) {
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [rows.length, title, emptyText]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE));
  const safePage = Math.min(page, totalPages);
  const slice = useMemo(() => {
    const p0 = (safePage - 1) * PAGE;
    return rows.slice(p0, p0 + PAGE);
  }, [rows, safePage]);

  const showNav = rows.length > PAGE;

  return (
    <article className="ops-card ops-card--list">
      <header className="ops-card__head">
        <h2 className="ops-card__title">{title}</h2>
        {viewAllTo ? (
          <div className="ops-card__actions">
            <Link className="ops-card__link" to={viewAllTo}>
              {viewAllLabel}
            </Link>
          </div>
        ) : null}
      </header>
      <div className="ops-card__body">
        {rows.length === 0 ? (
          <p className="ops-overview-empty">{emptyText}</p>
        ) : (
          <>
            <ul className="ops-list">
              {slice.map((r) => (
                <li
                  key={r.key}
                  className={["ops-list__row", r.sevTone ? `ops-list__row--${r.sevTone}` : ""].filter(Boolean).join(" ")}
                >
                  <div className="ops-list__main">
                    <div className="ops-list__title-line">{r.main}</div>
                    {r.meta ? <div className="ops-list__meta">{r.meta}</div> : null}
                  </div>
                  <div className="ops-list__ts">{r.ts}</div>
                </li>
              ))}
            </ul>
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
