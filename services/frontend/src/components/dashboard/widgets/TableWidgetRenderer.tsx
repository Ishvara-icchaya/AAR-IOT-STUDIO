import { useMemo } from "react";

import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { adaptTableWidget } from "@/lib/dashboard/adapters/widgetDataAdapters";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import type { ResolvedWidgetPresentation } from "@/lib/widgetPresentation";
import { formatDashboardValue, resolveWidgetPresentation } from "@/lib/widgetPresentation";
import { blinkModeClass, healthColorVar } from "@/lib/healthBlink";
import { tableVariantToAgMode } from "@/lib/dashboard/widgetVariants";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";

type RowIndicator = {
  health_status?: string;
  health_message?: string;
  blink_mode?: string;
};

type TableRowVm = Record<string, unknown> & {
  __health: RowIndicator;
  __rowKey: string;
};

function HealthCell({ row }: { row: TableRowVm }) {
  const ind = row.__health ?? {};
  const status = typeof ind.health_status === "string" ? ind.health_status : "";
  const chip = status ? status.toUpperCase() : "—";
  const msg = typeof ind.health_message === "string" ? ind.health_message : "";
  const blink = blinkModeClass(ind.blink_mode);
  return (
    <div className="dash-ag-health">
      <span
        className={`dash-health-dot ${blink}`.trim()}
        style={{
          display: "inline-block",
          width: "0.65em",
          height: "0.65em",
          borderRadius: "50%",
          background: healthColorVar(status || undefined),
          flexShrink: 0,
        }}
        title={msg || status || "Health"}
      />
      <span
        className="dash-health-chip"
        style={{
          fontSize: "0.75em",
          fontWeight: 600,
          padding: "0.1em 0.35em",
          borderRadius: 4,
          border: `1px solid ${healthColorVar(status || undefined)}`,
          color: healthColorVar(status || undefined),
          maxWidth: "6rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={msg || chip}
      >
        {chip}
      </span>
    </div>
  );
}

function formatCell(v: unknown, pres: Pick<ResolvedWidgetPresentation, "decimalPlaces" | "unit">): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "number") return formatDashboardValue(v, { decimalPlaces: pres.decimalPlaces, unit: "" });
  return String(v);
}

/** Dashboard live table widget — plain HTML table + client pagination. */
export function TableWidgetRenderer({ block }: { block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  const vm = adaptTableWidget(block);
  const isOpsDevice = block.type === "ops_device_table";
  const cfg = (block.config ?? {}) as Record<string, unknown>;
  const rows = vm.rows;
  const fields = vm.fields;
  const indicators = vm.rowIndicators as RowIndicator[];
  const updated = vm.updatedAt;

  const sourceLine =
    pres.showSource && (vm.displayName || vm.sourceId)
      ? `${vm.displayName ? vm.displayName : "Source"} · ${String(vm.sourceId ?? "").slice(0, 8)}…`
      : null;

  const frameState = rows.length === 0 ? "empty" : "normal";
  const emptyMessage = isOpsDevice ? "No devices available" : "No rows for this binding.";
  const tableMode = tableVariantToAgMode(pres);
  const opsPs = Math.floor(Number(cfg.pageSize ?? cfg.page_size ?? 8) || 8);
  const pageSize = isOpsDevice ? Math.max(4, Math.min(opsPs, 12)) : tableMode === "dense" ? 50 : 25;
  const density = tableMode === "dense" ? "compact" : tableMode === "full" ? "spacious" : "comfortable";

  const rowData: TableRowVm[] = useMemo(
    () =>
      rows.map((row, i) => ({
        ...row,
        __health: indicators[i] ?? {},
        __rowKey: `${block.widget_id}-${i}-${String(row.id ?? row.source_id ?? i)}`,
      })),
    [rows, indicators, block.widget_id],
  );

  const columns: PlainOperationalColumn<TableRowVm>[] = useMemo(() => {
    const dataCols: PlainOperationalColumn<TableRowVm>[] = fields.map((f) => ({
      id: f,
      header: vm.columnHeaders[f]?.trim() ? vm.columnHeaders[f] : f,
      cell: (r) => formatCell(r[f], pres),
    }));
    const healthCol: PlainOperationalColumn<TableRowVm> = {
      id: "__health",
      header: "",
      align: "left",
      cell: (r) => <HealthCell row={r} />,
    };
    return [healthCol, ...dataCols];
  }, [fields, pres, vm.columnHeaders]);

  return (
    <DashboardWidgetFrame
      block={block}
      presentation={pres}
      state={frameState}
      widgetKind="table"
      bodyFill
      emptyMessage={emptyMessage}
      sourceLine={sourceLine}
      updatedAtLine={pres.showUpdatedAt && updated ? `Updated ${new Date(updated).toLocaleString()}` : null}
    >
      <div
        className={`dash-wf-table__scroll dash-wf-table__scroll--plain${isOpsDevice ? " dash-wf-table__scroll--ops-device" : ""}`}
      >
        <PlainOperationalTable<TableRowVm>
          rows={rowData}
          columns={columns}
          getRowId={(r) => r.__rowKey}
          pageSize={pageSize}
          density={density}
          fillHeight={!isOpsDevice}
          pagination
          innerScroll={!isOpsDevice}
          resetPageKey={`${block.widget_id}-${rows.length}`}
          rowClassName={(r) => blinkModeClass(r.__health?.blink_mode)}
        />
      </div>
    </DashboardWidgetFrame>
  );
}
