import { useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import * as dashApi from "@/api/dashboard";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardWidgetPalette } from "@/components/dashboard/DashboardWidgetPalette";
import { DashboardRowBuilder } from "@/components/dashboard/DashboardRowBuilder";
import { DashboardPreviewPanel } from "@/components/dashboard/DashboardPreviewPanel";
import { DashboardWidgetConfigDrawer } from "@/components/dashboard/DashboardWidgetConfigDrawer";
import { paletteDropWidget, useDashboardBuilderStore } from "@/stores/dashboardBuilderStore";
import { PageShell } from "@/layouts/PageShell";
import "../device-register-page.css";

export function DashboardBuilderPage() {
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const resetFromServer = useDashboardBuilderStore((s) => s.resetFromServer);
  const layout = useDashboardBuilderStore((s) => s.layout);
  const addRow = useDashboardBuilderStore((s) => s.addRow);
  const moveRow = useDashboardBuilderStore((s) => s.moveRow);
  const placeWidget = useDashboardBuilderStore((s) => s.placeWidget);
  const moveWidget = useDashboardBuilderStore((s) => s.moveWidget);
  const status = useDashboardBuilderStore((s) => s.status);
  const frozen = status === "frozen";

  useEffect(() => {
    if (!dashboardId) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await dashApi.getDashboard(dashboardId);
        if (!cancelled && d) resetFromServer(d);
      } catch {
        /* handled by empty layout */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dashboardId, resetFromServer]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  /** Prefer the column under the pointer so widgets land in the intended row (closestCorners alone often snaps to the wrong slot). */
  function collisionDetection(
    args: Parameters<typeof pointerWithin>[0],
  ): ReturnType<typeof pointerWithin> {
    const inside = pointerWithin(args);
    if (inside.length > 0) return inside;
    return closestCorners(args);
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const aid = String(active.id);
    const oid = String(over.id);
    if (aid.startsWith("sort-row:") && oid.startsWith("sort-row:")) {
      const rows = useDashboardBuilderStore.getState().layout.rows;
      const oldIndex = rows.findIndex((r) => `sort-row:${r.rowId}` === aid);
      const newIndex = rows.findIndex((r) => `sort-row:${r.rowId}` === oid);
      if (oldIndex >= 0 && newIndex >= 0) moveRow(oldIndex, newIndex);
      return;
    }
    const a = active.data.current as { type?: string; widgetType?: string; rowId?: string; columnId?: string } | undefined;
    const o = over.data.current as { type?: string; rowId?: string; columnId?: string } | undefined;
    if (a?.type === "palette" && o?.type === "column" && a.widgetType && o.rowId && o.columnId) {
      placeWidget(o.rowId, o.columnId, paletteDropWidget(a.widgetType));
      return;
    }
    if (a?.type === "widget" && o?.type === "column" && a.rowId && a.columnId && o.rowId && o.columnId) {
      if (a.rowId === o.rowId && a.columnId === o.columnId) return;
      moveWidget(a.rowId, a.columnId, o.rowId, o.columnId);
    }
  }

  const rowIds = layout.rows.map((r) => `sort-row:${r.rowId}`);

  if (!dashboardId) {
    return <PageShell>Missing dashboard id.</PageShell>;
  }

  return (
    <div className="dash-builder-page">
      <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
        <DashboardHeader dashboardId={dashboardId} />
        <div className="dash-builder">
          <DashboardWidgetPalette />
          <main className="dash-builder__canvas">
            <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
              {layout.rows.map((row) => (
                <DashboardRowBuilder key={row.rowId} row={row} />
              ))}
            </SortableContext>
            <button type="button" className="dm-btn dm-btn--outline" disabled={frozen} onClick={() => addRow()}>
              Add row
            </button>
          </main>
          <DashboardPreviewPanel />
        </div>
        <DashboardWidgetConfigDrawer dashboardId={dashboardId} />
      </DndContext>
    </div>
  );
}
