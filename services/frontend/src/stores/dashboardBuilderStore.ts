import { create } from "zustand";
import type {
  DashboardColumnModel,
  DashboardLayoutModel,
  DashboardLayoutSettings,
  DashboardRowModel,
  DashboardWidgetModel,
} from "@/types/dashboardLayout";
import type { DashboardReadDTO } from "@/types/dashboard";
import { ROW_PRESETS, type RowPresetKey, createDefaultWidget } from "@/lib/dashboardDefaults";

function normalizeSettings(raw: unknown): DashboardLayoutSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const refresh = s.refreshIntervalSec ?? s.refresh_interval_sec;
  const mapUrl = s.mapStyleUrl ?? s.map_style_url;
  const out: DashboardLayoutSettings = {};
  if (typeof refresh === "number" && Number.isFinite(refresh)) out.refreshIntervalSec = refresh;
  if (typeof refresh === "string" && refresh.trim()) {
    const n = Number(refresh);
    if (Number.isFinite(n)) out.refreshIntervalSec = n;
  }
  if (typeof mapUrl === "string" && mapUrl.trim()) out.mapStyleUrl = mapUrl.trim();
  return Object.keys(out).length ? out : undefined;
}

function normalizeLayout(raw: Record<string, unknown> | undefined): DashboardLayoutModel {
  if (!raw || typeof raw !== "object") return { version: 1, rows: [] };
  const rowsIn = Array.isArray(raw.rows) ? raw.rows : [];
  const rows: DashboardLayoutModel["rows"] = rowsIn.map((r: unknown) => {
    if (!r || typeof r !== "object") return { rowId: crypto.randomUUID(), heightWeight: 1, columns: [] };
    const row = r as Record<string, unknown>;
    const rowId = String(row.rowId ?? row.row_id ?? crypto.randomUUID());
    const hwRaw = row.heightWeight ?? row.height_weight;
    let heightWeight = 1;
    if (typeof hwRaw === "number" && Number.isFinite(hwRaw) && hwRaw > 0) {
      heightWeight = Math.min(40, Math.max(0.25, hwRaw));
    }
    const colsIn = Array.isArray(row.columns) ? row.columns : [];
    const columns = colsIn.map((c: unknown) => {
      if (!c || typeof c !== "object") return { columnId: crypto.randomUUID(), span: 12 };
      const col = c as Record<string, unknown>;
      const columnId = String(col.columnId ?? col.column_id ?? crypto.randomUUID());
      const span = typeof col.span === "number" ? col.span : 12;
      let widget: DashboardWidgetModel | undefined;
      const w = col.widget;
      if (w && typeof w === "object") {
        const o = w as Record<string, unknown>;
        widget = {
          widgetId: String(o.widgetId ?? o.widget_id ?? crypto.randomUUID()),
          type: String(o.type ?? "text"),
          title: String(o.title ?? ""),
          binding: (o.binding as DashboardWidgetModel["binding"]) || {},
          config: (o.config as Record<string, unknown>) || {},
        };
      }
      return { columnId, span, widget };
    });
    return { rowId, heightWeight, columns };
  });
  const settings = normalizeSettings(raw.settings);
  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    rows,
    ...(settings ? { settings } : {}),
  };
}

/**
 * Map widgets must live in their own row with a single column (span 12). Split mixed rows
 * in column order so non-map columns stay grouped before/after maps as separate rows.
 */
export function normalizeLayoutForMapWidgets(layout: DashboardLayoutModel): DashboardLayoutModel {
  const nextRows: DashboardRowModel[] = [];

  for (const row of layout.rows) {
    const rowHw = row.heightWeight ?? 1;
    let buf: DashboardColumnModel[] = [];
    let firstChunk = true;

    /** When `endOfRow` is false (flush before a map), drop non-map columns that have no widget — avoids junk rows. When `endOfRow` is true, keep placeholder columns so empty builder rows (e.g. after Add row) are not stripped. */
    const flushBuf = (preferRowId: string, endOfRow: boolean) => {
      if (buf.length === 0) return;
      const hasWidget = buf.some((c) => c.widget != null);
      if (!hasWidget && !endOfRow) {
        buf = [];
        return;
      }
      if (!hasWidget && endOfRow) {
        const rid = firstChunk ? preferRowId : crypto.randomUUID();
        firstChunk = false;
        nextRows.push({
          rowId: rid,
          heightWeight: rowHw,
          columns: buf.map((c) => ({ ...c })),
        });
        buf = [];
        return;
      }
      const rid = firstChunk ? preferRowId : crypto.randomUUID();
      firstChunk = false;
      nextRows.push({
        rowId: rid,
        heightWeight: rowHw,
        columns: buf.map((c) => ({ ...c })),
      });
      buf = [];
    };

    for (const col of row.columns) {
      if (col.widget?.type === "map") {
        flushBuf(row.rowId, false);
        nextRows.push({
          rowId: crypto.randomUUID(),
          heightWeight: rowHw,
          columns: [{ columnId: crypto.randomUUID(), span: 12, widget: col.widget }],
        });
      } else {
        buf.push(col);
      }
    }
    flushBuf(row.rowId, true);
  }

  return { ...layout, rows: nextRows };
}

export function layoutToApiJson(layout: DashboardLayoutModel): Record<string, unknown> {
  const base: Record<string, unknown> = {
    version: layout.version,
    rows: layout.rows.map((row) => ({
      rowId: row.rowId,
      heightWeight: row.heightWeight ?? 1,
      columns: row.columns.map((col) => ({
        columnId: col.columnId,
        span: col.span,
        widget: col.widget
          ? {
              widgetId: col.widget.widgetId,
              type: col.widget.type,
              title: col.widget.title,
              binding: col.widget.binding,
              config: col.widget.config,
            }
          : undefined,
      })),
    })),
  };
  if (layout.settings && Object.keys(layout.settings).length > 0) {
    base.settings = { ...layout.settings };
  }
  return base;
}

type DrawerTarget = { rowId: string; columnId: string } | null;

type BuilderState = {
  dashboardId: string | null;
  siteId: string | null;
  name: string;
  description: string;
  status: string;
  isPrimary: boolean;
  layout: DashboardLayoutModel;
  drawerOpen: boolean;
  drawerTarget: DrawerTarget;
  previewPayload: import("@/types/dashboard").DashboardLiveDTO | null;
  dirty: boolean;
};

type BuilderActions = {
  resetFromServer: (d: DashboardReadDTO) => void;
  setName: (name: string) => void;
  setDescription: (d: string) => void;
  setLayout: (layout: DashboardLayoutModel) => void;
  markClean: () => void;
  setPreviewPayload: (p: import("@/types/dashboard").DashboardLiveDTO | null) => void;
  addRow: () => void;
  removeRow: (rowId: string) => void;
  setRowHeightWeight: (rowId: string, heightWeight: number) => void;
  applyRowPreset: (rowId: string, preset: RowPresetKey) => void;
  addColumn: (rowId: string) => void;
  removeColumn: (rowId: string, columnId: string) => void;
  setColumnSpan: (rowId: string, columnId: string, span: number) => void;
  moveRow: (fromIndex: number, toIndex: number) => void;
  placeWidget: (rowId: string, columnId: string, widget: DashboardWidgetModel) => void;
  moveWidget: (fromRow: string, fromCol: string, toRow: string, toCol: string) => void;
  removeWidget: (rowId: string, columnId: string) => void;
  updateWidget: (rowId: string, columnId: string, widget: DashboardWidgetModel) => void;
  openDrawer: (rowId: string, columnId: string) => void;
  closeDrawer: () => void;
  setDashboardSettings: (partial: Partial<DashboardLayoutSettings>) => void;
};

const initial: BuilderState = {
  dashboardId: null,
  siteId: null,
  name: "",
  description: "",
  status: "draft",
  isPrimary: false,
  layout: { version: 1, rows: [], settings: { refreshIntervalSec: 30 } },
  drawerOpen: false,
  drawerTarget: null,
  previewPayload: null,
  dirty: false,
};

export const useDashboardBuilderStore = create<BuilderState & BuilderActions>((set) => ({
  ...initial,

  resetFromServer: (d) =>
    set({
      dashboardId: d.id,
      siteId: d.site_id,
      name: d.name,
      description: d.description ?? "",
      status: d.status,
      isPrimary: d.is_primary,
      layout: normalizeLayoutForMapWidgets(normalizeLayout(d.layout)),
      dirty: false,
      drawerOpen: false,
      drawerTarget: null,
      previewPayload: null,
    }),

  setName: (name) => set({ name, dirty: true }),
  setDescription: (description) => set({ description, dirty: true }),
  setLayout: (layout) => set({ layout: normalizeLayoutForMapWidgets(layout), dirty: true }),
  markClean: () => set({ dirty: false }),
  setPreviewPayload: (previewPayload) => set({ previewPayload }),

  addRow: () =>
    set((s) => ({
      layout: normalizeLayoutForMapWidgets({
        ...s.layout,
        rows: [
          ...s.layout.rows,
          {
            rowId: crypto.randomUUID(),
            heightWeight: 1,
            columns: [{ columnId: crypto.randomUUID(), span: 12 }],
          },
        ],
      }),
      dirty: true,
    })),

  setRowHeightWeight: (rowId, heightWeight) =>
    set((s) => {
      const w = Math.min(40, Math.max(0.25, heightWeight));
      const rows = s.layout.rows.map((row) =>
        row.rowId === rowId ? { ...row, heightWeight: w } : row,
      );
      return { layout: { ...s.layout, rows }, dirty: true };
    }),

  removeRow: (rowId) =>
    set((s) => ({
      layout: normalizeLayoutForMapWidgets({
        ...s.layout,
        rows: s.layout.rows.filter((r) => r.rowId !== rowId),
      }),
      dirty: true,
    })),

  applyRowPreset: (rowId, preset) =>
    set((s) => {
      const spans = [...ROW_PRESETS[preset]];
      const rows = s.layout.rows.map((row) => {
        if (row.rowId !== rowId) return row;
        const columns = spans.map((span) => ({
          columnId: crypto.randomUUID(),
          span,
          widget: undefined as DashboardWidgetModel | undefined,
        }));
        const old = row.columns;
        for (let i = 0; i < Math.min(old.length, columns.length); i++) {
          columns[i] = { ...columns[i], widget: old[i]?.widget };
        }
        return { ...row, columns, heightWeight: row.heightWeight ?? 1 };
      });
      return { layout: normalizeLayoutForMapWidgets({ ...s.layout, rows }), dirty: true };
    }),

  addColumn: (rowId) =>
    set((s) => {
      const rows = s.layout.rows.map((row) =>
        row.rowId === rowId
          ? {
              ...row,
              columns: [...row.columns, { columnId: crypto.randomUUID(), span: 6 }],
            }
          : row,
      );
      return { layout: normalizeLayoutForMapWidgets({ ...s.layout, rows }), dirty: true };
    }),

  removeColumn: (rowId, columnId) =>
    set((s) => {
      const rows = s.layout.rows.map((row) =>
        row.rowId === rowId
          ? { ...row, columns: row.columns.filter((c) => c.columnId !== columnId) }
          : row,
      );
      return { layout: normalizeLayoutForMapWidgets({ ...s.layout, rows }), dirty: true };
    }),

  setColumnSpan: (rowId, columnId, span) =>
    set((s) => {
      const rows = s.layout.rows.map((row) =>
        row.rowId === rowId
          ? {
              ...row,
              columns: row.columns.map((c) => {
                if (c.columnId !== columnId) return c;
                if (c.widget?.type === "map") return { ...c, span: 12 };
                return { ...c, span };
              }),
            }
          : row,
      );
      return { layout: normalizeLayoutForMapWidgets({ ...s.layout, rows }), dirty: true };
    }),

  moveRow: (fromIndex, toIndex) =>
    set((s) => {
      const rows = [...s.layout.rows];
      const [removed] = rows.splice(fromIndex, 1);
      rows.splice(toIndex, 0, removed);
      return { layout: normalizeLayoutForMapWidgets({ ...s.layout, rows }), dirty: true };
    }),

  placeWidget: (rowId, columnId, widget) =>
    set((s) => {
      const rows = s.layout.rows.map((row) =>
        row.rowId === rowId
          ? {
              ...row,
              columns: row.columns.map((c) => {
                if (c.columnId !== columnId) return c;
                if (widget.type === "map") return { ...c, span: 12, widget };
                return { ...c, widget };
              }),
            }
          : row,
      );
      return { layout: normalizeLayoutForMapWidgets({ ...s.layout, rows }), dirty: true };
    }),

  moveWidget: (fromRow, fromCol, toRow, toCol) =>
    set((s) => {
      if (fromRow === toRow && fromCol === toCol) return s;
      const layout: DashboardLayoutModel = JSON.parse(JSON.stringify(s.layout)) as DashboardLayoutModel;
      const fromR = layout.rows.find((r) => r.rowId === fromRow);
      const toR = layout.rows.find((r) => r.rowId === toRow);
      const fromC = fromR?.columns.find((c) => c.columnId === fromCol);
      const toC = toR?.columns.find((c) => c.columnId === toCol);
      if (!fromC || !toC || !fromC.widget) return s;
      const moving = fromC.widget;
      const displaced = toC.widget;
      fromC.widget = displaced;
      toC.widget = moving;
      if (toC.widget?.type === "map") {
        toC.span = 12;
      }
      if (fromC.widget?.type === "map") {
        fromC.span = 12;
      }
      return { layout: normalizeLayoutForMapWidgets(layout), dirty: true };
    }),

  removeWidget: (rowId, columnId) =>
    set((s) => {
      const rows = s.layout.rows.map((row) =>
        row.rowId === rowId
          ? {
              ...row,
              columns: row.columns.map((c) =>
                c.columnId === columnId ? { ...c, widget: undefined } : c,
              ),
            }
          : row,
      );
      return { layout: normalizeLayoutForMapWidgets({ ...s.layout, rows }), dirty: true };
    }),

  updateWidget: (rowId, columnId, widget) =>
    set((s) => {
      const rows = s.layout.rows.map((row) =>
        row.rowId === rowId
          ? {
              ...row,
              columns: row.columns.map((c) => {
                if (c.columnId !== columnId) return c;
                if (widget.type === "map") return { ...c, span: 12, widget };
                return { ...c, widget };
              }),
            }
          : row,
      );
      return { layout: normalizeLayoutForMapWidgets({ ...s.layout, rows }), dirty: true };
    }),

  openDrawer: (rowId, columnId) => set({ drawerOpen: true, drawerTarget: { rowId, columnId } }),
  closeDrawer: () => set({ drawerOpen: false, drawerTarget: null }),

  setDashboardSettings: (partial) =>
    set((s) => ({
      layout: {
        ...s.layout,
        settings: { ...s.layout.settings, ...partial },
      },
      dirty: true,
    })),
}));

export function paletteDropWidget(widgetType: string): DashboardWidgetModel {
  return createDefaultWidget(widgetType);
}
