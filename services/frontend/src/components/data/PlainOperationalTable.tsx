import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { AarButton } from "@/components/system/AarButton";
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
  /** `dm`: Manage Devices–style table (dm-table-scroll, dm-data-table__td/th). */
  tableVariant?: "op" | "dm";
};

function alignClassOp(align: PlainOperationalColumn<unknown>["align"], prefix: "th" | "td"): string {
  if (align === "center") return ` op-data-table__${prefix}--center`;
  if (align === "right") return ` op-data-table__${prefix}--right`;
  return "";
}

function alignClassDm(align: PlainOperationalColumn<unknown>["align"], prefix: "th" | "td"): string {
  if (align === "center") return ` dm-data-table__${prefix}--center`;
  if (align === "right") return ` dm-data-table__${prefix}--right`;
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
  tableVariant = "op",
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
    return (
      <p className={tableVariant === "dm" ? "dm-plain-table-empty" : "op-table-empty"}>{emptyMessage || "No rows."}</p>
    );
  }

  const alignCell = tableVariant === "dm" ? alignClassDm : alignClassOp;

  const densityClass =
    tableVariant === "op" && density === "compact"
      ? " op-data-table--dense"
      : tableVariant === "op" && density === "spacious"
        ? " op-data-table--spacious"
        : "";

  const scrollStyle: CSSProperties | undefined =
    !fillHeight && maxHeight ? { maxHeight } : !fillHeight ? undefined : { maxHeight: "none" };

  const shellClass =
    tableVariant === "dm"
      ? ["dm-plain-table-harness", fillHeight ? "dm-plain-table-harness--fill" : "", className].filter(Boolean).join(" ")
      : [
          "op-table-shell",
          fillHeight ? "op-table-shell--fill" : "",
          bordered ? "op-table-shell--bordered" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ");

  const scrollClass =
    tableVariant === "dm"
      ? ["dm-table-scroll", !innerScroll ? "dm-table-scroll--static" : ""].filter(Boolean).join(" ")
      : ["op-table-scroll", !innerScroll ? "op-table-scroll--static" : ""].filter(Boolean).join(" ");

  const tableClass = tableVariant === "dm" ? "dm-data-table" : `op-data-table${densityClass}`;
  const thBase = tableVariant === "dm" ? "dm-data-table__th" : "op-data-table__th";
  const tdBase = tableVariant === "dm" ? "dm-data-table__td" : "op-data-table__td";
  const rowBase = tableVariant === "dm" ? "dm-data-table__row" : "op-data-table__row";
  const rowClick = tableVariant === "dm" ? "dm-data-table__row--clickable" : "op-data-table__row--clickable";
  const loadingCls = tableVariant === "dm" ? "dm-table-loading" : "op-table-loading";
  const pagerCls = tableVariant === "dm" ? "dm-table-pager" : "op-table-pager";
  const pagerControlsCls = tableVariant === "dm" ? "dm-table-pager__controls" : "op-table-pager__controls";
  const muted = tableVariant === "dm" ? "var(--dm-muted)" : "var(--color-text-muted)";

  return (
    <div className={shellClass}>
      {loading ? <p className={loadingCls}>{loadingMessage}</p> : null}
      <div className={scrollClass} style={scrollStyle}>
        <table className={tableClass}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className={`${thBase}${alignCell(col.align, "th")}`}
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
                <td className={tdBase} colSpan={columns.length} style={{ color: muted }}>
                  {loadingMessage}
                </td>
              </tr>
            ) : !loading && pageRows.length === 0 ? (
              <tr>
                <td className={tdBase} colSpan={columns.length} style={{ color: muted }}>
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
                    className={[rowBase, onRowClick ? rowClick : "", extra || ""].filter(Boolean).join(" ")}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((col) => (
                      <td key={col.id} className={`${tdBase}${alignCell(col.align, "td")}`}>
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
        <div className={pagerCls} role="navigation" aria-label={pagerAriaLabel}>
          <span>
            {rangeStart}–{rangeEnd} of {rows.length}
          </span>
          <div className={pagerControlsCls}>
            <AarButton
              variant="outline"
              className="op-table-pager__action"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </AarButton>
            <span>
              Page {page} / {totalPages}
            </span>
            <AarButton
              variant="outline"
              className="op-table-pager__action"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </AarButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
