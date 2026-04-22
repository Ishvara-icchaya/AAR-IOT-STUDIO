import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import "./plainOperationalTable.css";

export const PLAIN_TABLE_PAGE_SIZE_DEFAULT = 25;

export type PlainOperationalColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "center" | "right";
  headerTitle?: string;
};

export type PlainOperationalTableProps<T> = {
  rows: T[];
  columns: PlainOperationalColumn<T>[];
  getRowId: (row: T) => string;
  pageSize?: number;
  /** Client-side pagination. Default true. */
  pagination?: boolean;
  loading?: boolean;
  loadingMessage?: string;
  /**
   * When a string and rows are empty, show only this message (no table).
   * `undefined`: always render the table shell. `null`: same as undefined (table shell with empty body).
   */
  emptyMessage?: string | null;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  fillHeight?: boolean;
  /** Applied to the scroll wrapper when not fillHeight. */
  maxHeight?: string;
  /** Table density: affects row height / font. */
  density?: "comfortable" | "compact" | "spacious";
  className?: string;
  /** When this value changes, pagination resets to page 1. */
  resetPageKey?: string | number | boolean;
  pagerAriaLabel?: string;
  /** When false, inner table area does not scroll (pager only). Default true. */
  innerScroll?: boolean;
  /** Adds border + radius around the shell (monitoring-style). */
  bordered?: boolean;
};

function alignClass(align: PlainOperationalColumn<unknown>["align"], prefix: "th" | "td"): string {
  if (align === "center") return ` op-data-table__${prefix}--center`;
  if (align === "right") return ` op-data-table__${prefix}--right`;
  return "";
}

export function PlainOperationalTable<T>({
  rows,
  columns,
  getRowId,
  pageSize = PLAIN_TABLE_PAGE_SIZE_DEFAULT,
  pagination = true,
  loading = false,
  loadingMessage = "Loading…",
  emptyMessage,
  onRowClick,
  rowClassName,
  fillHeight = false,
  maxHeight,
  density = "comfortable",
  className = "",
  resetPageKey,
  pagerAriaLabel = "Table pages",
  bordered = false,
  innerScroll = true,
}: PlainOperationalTableProps<T>) {
  const [page, setPage] = useState(1);

  const totalPages = pagination ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;

  useEffect(() => {
    setPage(1);
  }, [resetPageKey]);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages, rows.length]);

  const pageRows = useMemo(() => {
    if (!pagination) return rows;
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize, pagination]);

  const showPager = pagination && totalPages > 1;
  const rangeStart = rows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = pagination ? Math.min(rows.length, page * pageSize) : rows.length;

  if (typeof emptyMessage === "string" && rows.length === 0 && !loading) {
    return <p className="op-table-empty">{emptyMessage || "No rows."}</p>;
  }

  const densityClass =
    density === "compact" ? " op-data-table--dense" : density === "spacious" ? " op-data-table--spacious" : "";

  const scrollStyle: CSSProperties | undefined =
    !fillHeight && maxHeight ? { maxHeight } : !fillHeight ? undefined : { maxHeight: "none" };

  return (
    <div
      className={[
        "op-table-shell",
        fillHeight ? "op-table-shell--fill" : "",
        bordered ? "op-table-shell--bordered" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {loading ? <p className="op-table-loading">{loadingMessage}</p> : null}
      <div
        className={["op-table-scroll", !innerScroll ? "op-table-scroll--static" : ""].filter(Boolean).join(" ")}
        style={scrollStyle}
      >
        <table className={`op-data-table${densityClass}`}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className={`op-data-table__th${alignClass(col.align, "th")}`}
                  scope="col"
                  title={col.headerTitle}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td className="op-data-table__td" colSpan={columns.length} style={{ color: "var(--color-text-muted)" }}>
                  {loadingMessage}
                </td>
              </tr>
            ) : !loading && pageRows.length === 0 ? (
              <tr>
                <td className="op-data-table__td" colSpan={columns.length} style={{ color: "var(--color-text-muted)" }}>
                  No rows.
                </td>
              </tr>
            ) : (
              pageRows.map((row) => {
                const id = getRowId(row);
                const extra = rowClassName?.(row);
                return (
                  <tr
                    key={id}
                    className={["op-data-table__row", onRowClick ? "op-data-table__row--clickable" : "", extra || ""]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((col) => (
                      <td key={col.id} className={`op-data-table__td${alignClass(col.align, "td")}`}>
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {showPager ? (
        <div className="op-table-pager" role="navigation" aria-label={pagerAriaLabel}>
          <span>
            {rangeStart}–{rangeEnd} of {rows.length}
          </span>
          <div className="op-table-pager__controls">
            <button
              type="button"
              className="op-table-pager__btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span>
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              className="op-table-pager__btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
