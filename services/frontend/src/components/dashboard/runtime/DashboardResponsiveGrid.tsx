import { useMemo, type CSSProperties } from "react";
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { tuneRowWeightsForViewport, type ParsedLayoutRow } from "@/lib/dashboard/dashboardLayoutEngine";
import { useDashboardResize } from "./DashboardResizeManager";
import { DashboardWidgetView } from "../DashboardLiveRenderer";

type Props = {
  rows: ParsedLayoutRow[];
  widgetsById: Record<string, DashboardLiveWidgetDTO>;
  fitPage: boolean;
  renderedAt?: string;
  /** Hide raw ISO "Rendered …" line (reference / default ops dashboard). */
  hideRenderedMeta?: boolean;
};

/**
 * Row/column grid from parsed layout metadata — flex weights + 12-column spans.
 */
export function DashboardResponsiveGrid({
  rows,
  widgetsById,
  fitPage,
  renderedAt,
  hideRenderedMeta,
}: Props) {
  const resize = useDashboardResize();
  const tunedRows = useMemo(() => {
    if (!fitPage || !resize?.height) return rows;
    return tuneRowWeightsForViewport(rows, resize.height);
  }, [rows, fitPage, resize?.height]);

  return (
    <>
      {renderedAt && !hideRenderedMeta ? (
        <p className="dash-live__meta dash-widget__muted">Rendered {renderedAt}</p>
      ) : null}
      {tunedRows.map((row, ri) => {
        const hw = row.heightWeight ?? 1;
        return (
          <div
            key={row.rowId || `row-${ri}`}
            className="dash-row"
            style={fitPage ? { flex: `${hw} 1 0%`, minHeight: 0, minWidth: 0 } : undefined}
          >
            {row.columns.map((col) => (
              <div
                key={col.columnId}
                className={[
                  "dash-col",
                  col.widget ? `dash-col--slot-${col.slotKind}` : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  gridColumn: `span ${Math.min(12, Math.max(1, col.span))}`,
                  ...(col.slotKind === "data"
                    ? ({
                        ["--dash-slot-min-h" as string]: `${Math.max(col.slotMinHeightPx, 160)}px`,
                      } as CSSProperties)
                    : {}),
                }}
              >
                {col.widget ? (
                  (() => {
                    const b = widgetsById[col.widget.widgetId];
                    if (!b) {
                      return (
                        <div className="dash-widget dash-widget--empty">
                          <p className="dash-widget__muted">
                            No resolved data for this widget slot (layout may be out of sync).
                          </p>
                        </div>
                      );
                    }
                    return <DashboardWidgetView block={b} />;
                  })()
                ) : (
                  <div className="dash-slot dash-slot--empty" />
                )}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
