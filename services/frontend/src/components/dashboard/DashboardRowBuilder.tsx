import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DashboardRowModel } from "@/types/dashboardLayout";
import type { RowPresetKey } from "@/lib/dashboardDefaults";
import { DashboardColumnSlot } from "./DashboardColumnSlot";
import { useDashboardBuilderStore } from "@/stores/dashboardBuilderStore";

export function DashboardRowBuilder({ row, readOnly }: { row: DashboardRowModel; readOnly?: boolean }) {
  const applyRowPreset = useDashboardBuilderStore((s) => s.applyRowPreset);
  const setRowHeightWeight = useDashboardBuilderStore((s) => s.setRowHeightWeight);
  const addColumn = useDashboardBuilderStore((s) => s.addColumn);
  const removeRow = useDashboardBuilderStore((s) => s.removeRow);
  const status = useDashboardBuilderStore((s) => s.status);
  const frozen = status === "frozen";
  const rowHasMap = row.columns.some((c) => c.widget?.type === "map");

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `sort-row:${row.rowId}`,
    disabled: readOnly || frozen,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="dash-builder-row">
      {!readOnly && !frozen && (
        <button
          type="button"
          className="dash-builder-row__grip"
          {...attributes}
          {...listeners}
          aria-label="Reorder row"
        >
          ⣿
        </button>
      )}
      <div className="dash-builder-row__body">
        <div className="dash-builder-row__controls">
          <label>
            Row height share
            <input
              type="number"
              min={0.25}
              max={40}
              step={0.25}
              disabled={frozen || readOnly}
              value={row.heightWeight ?? 1}
              title="Relative height of this row on live / preview (larger = more vertical space)."
              onChange={(e) => setRowHeightWeight(row.rowId, Number(e.target.value) || 1)}
            />
          </label>
          <label>
            Row layout
            <select
              disabled={frozen || readOnly || rowHasMap}
              defaultValue=""
              title={
                rowHasMap
                  ? "Change row layout is disabled while this row contains a map (map is always full-width)."
                  : undefined
              }
              onChange={(e) => {
                const v = e.target.value as RowPresetKey | "";
                if (v) applyRowPreset(row.rowId, v);
                e.target.value = "";
              }}
            >
              <option value="" disabled>
                Preset…
              </option>
              <option value="1">1 column</option>
              <option value="2">2 columns</option>
              <option value="3">3 columns</option>
              <option value="4">4 columns</option>
            </select>
          </label>
          {!readOnly && !frozen && (
            <>
              <button
                type="button"
                className="dash-btn dash-btn--small"
                disabled={rowHasMap}
                title={
                  rowHasMap
                    ? "A map uses the full row; add another row for more widgets."
                    : undefined
                }
                onClick={() => addColumn(row.rowId)}
              >
                + Column
              </button>
              <button type="button" className="dash-btn dash-btn--small dash-btn--danger" onClick={() => removeRow(row.rowId)}>
                Delete row
              </button>
            </>
          )}
        </div>
        <div className="dash-row dash-row--builder">
          {row.columns.map((col) => (
            <DashboardColumnSlot key={col.columnId} rowId={row.rowId} column={col} readOnly={readOnly} />
          ))}
        </div>
      </div>
    </div>
  );
}
