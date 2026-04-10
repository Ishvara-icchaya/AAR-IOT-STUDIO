import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { DashboardColumnModel } from "@/types/dashboardLayout";
import { useDashboardBuilderStore } from "@/stores/dashboardBuilderStore";

export function DashboardColumnSlot({ rowId, column, readOnly }: { rowId: string; column: DashboardColumnModel; readOnly?: boolean }) {
  const openDrawer = useDashboardBuilderStore((s) => s.openDrawer);
  const removeWidget = useDashboardBuilderStore((s) => s.removeWidget);
  const setColumnSpan = useDashboardBuilderStore((s) => s.setColumnSpan);
  const removeColumn = useDashboardBuilderStore((s) => s.removeColumn);
  const status = useDashboardBuilderStore((s) => s.status);
  const frozen = status === "frozen";

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `col:${rowId}:${column.columnId}`,
    data: { type: "column", rowId, columnId: column.columnId },
    disabled: readOnly || frozen,
  });

  const w = column.widget;
  const mapLocked = w?.type === "map";
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: w ? `widget:${rowId}:${column.columnId}` : `nowidget:${rowId}:${column.columnId}`,
    data: w ? { type: "widget", rowId, columnId: column.columnId } : undefined,
    disabled: !w || readOnly || frozen,
  });

  const gridSpan = mapLocked ? 12 : column.span;

  return (
    <div
      ref={setDropRef}
      className={`dash-slot${isOver ? " dash-slot--over" : ""}`}
      style={{ gridColumn: `span ${Math.min(12, Math.max(1, gridSpan))}` }}
    >
      <div className="dash-slot__toolbar">
        <label className="dash-slot__span">
          span
          <input
            type="number"
            min={1}
            max={12}
            value={mapLocked ? 12 : column.span}
            disabled={frozen || readOnly || mapLocked}
            title={mapLocked ? "Map widgets always use full width (12)." : undefined}
            onChange={(e) => setColumnSpan(rowId, column.columnId, Number(e.target.value) || 1)}
          />
        </label>
        {!readOnly && !frozen && (
          <button
            type="button"
            className="dash-slot__x"
            disabled={mapLocked}
            title={
              mapLocked
                ? "Map rows are a single full-width column — remove the widget or delete the row."
                : "Remove column"
            }
            onClick={() => removeColumn(rowId, column.columnId)}
          >
            ×
          </button>
        )}
      </div>
      {w ? (
        <div
          ref={setDragRef}
          {...listeners}
          {...attributes}
          className={`dash-slot__card${isDragging ? " dash-slot__card--dragging" : ""}`}
        >
          <div className="dash-slot__card-head">
            <strong>{w.title || w.type}</strong>
            <span className="dash-slot__type">{w.type}</span>
          </div>
          {!readOnly && !frozen && (
            <div className="dash-slot__card-actions">
              <button type="button" className="dash-link" onClick={() => openDrawer(rowId, column.columnId)}>
                Configure
              </button>
              <button type="button" className="dash-link dash-link--danger" onClick={() => removeWidget(rowId, column.columnId)}>
                Remove
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="dash-slot__placeholder">{frozen || readOnly ? "Empty" : "Drop widget here"}</div>
      )}
    </div>
  );
}
