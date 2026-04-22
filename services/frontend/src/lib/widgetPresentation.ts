import type { DashboardLiveWidgetDTO } from "@/types/dashboard";

export type WidgetVariant = "compact" | "standard" | "full" | "dense";
export type VerticalAlign = "start" | "center" | "end" | "stretch";
export type ContentDensity = "comfortable" | "compact" | "dense";

/** Merged presentation used by DashboardWidgetFrame and widgets. */
export type ResolvedWidgetPresentation = {
  variant: WidgetVariant;
  verticalAlign: VerticalAlign;
  showTitle: boolean;
  showSource: boolean;
  showUpdatedAt: boolean;
  decimalPlaces: number;
  unit: string;
  contentDensity: ContentDensity;
};

const VARIANTS = new Set<WidgetVariant>(["compact", "standard", "full", "dense"]);
const ALIGNS = new Set<VerticalAlign>(["start", "center", "end", "stretch"]);
const DENSITIES = new Set<ContentDensity>(["comfortable", "compact", "dense"]);

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function pickBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function pickNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function mergePresentationLayer(base: Record<string, unknown>): Partial<ResolvedWidgetPresentation> {
  const variantRaw = pickStr(base.variant);
  const variant =
    variantRaw && VARIANTS.has(variantRaw as WidgetVariant) ? (variantRaw as WidgetVariant) : undefined;
  const verticalAlignRaw = pickStr(base.verticalAlign ?? base.vertical_align);
  const verticalAlign =
    verticalAlignRaw && ALIGNS.has(verticalAlignRaw as VerticalAlign)
      ? (verticalAlignRaw as VerticalAlign)
      : undefined;
  const contentDensityRaw = pickStr(base.contentDensity ?? base.content_density);
  const contentDensity =
    contentDensityRaw && DENSITIES.has(contentDensityRaw as ContentDensity)
      ? (contentDensityRaw as ContentDensity)
      : undefined;
  return {
    variant,
    verticalAlign,
    showTitle: pickBool(base.showTitle ?? base.show_title),
    showSource: pickBool(base.showSource ?? base.show_source),
    showUpdatedAt: pickBool(base.showUpdatedAt ?? base.show_updated_at),
    decimalPlaces: pickNum(base.decimalPlaces ?? base.decimal_places),
    unit: pickStr(base.unit),
    contentDensity,
  };
}

function presentationSources(block: DashboardLiveWidgetDTO): Record<string, unknown> {
  const cfg = block.config && typeof block.config === "object" ? (block.config as Record<string, unknown>) : {};
  const nested =
    cfg.presentation && typeof cfg.presentation === "object" ? (cfg.presentation as Record<string, unknown>) : {};
  const fromFlat = mergePresentationLayer(cfg);
  const data = block.data && typeof block.data === "object" ? (block.data as Record<string, unknown>) : {};
  const fromData =
    data.presentation && typeof data.presentation === "object" ? (data.presentation as Record<string, unknown>) : {};
  return { ...fromFlat, ...nested, ...fromData };
}

const DEFAULTS_BY_TYPE: Record<string, Partial<ResolvedWidgetPresentation>> = {
  kpi: {
    variant: "standard",
    verticalAlign: "center",
    showTitle: true,
    showSource: true,
    showUpdatedAt: true,
    decimalPlaces: 2,
    unit: "",
    contentDensity: "comfortable",
  },
  table: {
    variant: "standard",
    verticalAlign: "stretch",
    showTitle: true,
    showSource: false,
    showUpdatedAt: false,
    decimalPlaces: 2,
    unit: "",
    contentDensity: "compact",
  },
  chart: {
    variant: "full",
    verticalAlign: "stretch",
    showTitle: true,
    showSource: true,
    showUpdatedAt: true,
    decimalPlaces: 2,
    unit: "",
    contentDensity: "comfortable",
  },
  map: {
    variant: "full",
    verticalAlign: "stretch",
    showTitle: true,
    showSource: false,
    showUpdatedAt: false,
    decimalPlaces: 2,
    unit: "",
    contentDensity: "compact",
  },
  device_tile: {
    variant: "standard",
    verticalAlign: "start",
    showTitle: true,
    showSource: true,
    showUpdatedAt: true,
    decimalPlaces: 2,
    unit: "",
    contentDensity: "comfortable",
  },
  health_summary: {
    variant: "compact",
    verticalAlign: "center",
    showTitle: true,
    showSource: false,
    showUpdatedAt: false,
    decimalPlaces: 0,
    unit: "",
    contentDensity: "compact",
  },
  alert_summary: {
    variant: "standard",
    verticalAlign: "stretch",
    showTitle: true,
    showSource: false,
    showUpdatedAt: false,
    decimalPlaces: 0,
    unit: "",
    contentDensity: "compact",
  },
  site_summary: {
    variant: "standard",
    verticalAlign: "center",
    showTitle: true,
    showSource: false,
    showUpdatedAt: false,
    decimalPlaces: 0,
    unit: "",
    contentDensity: "comfortable",
  },
  text: {
    variant: "standard",
    verticalAlign: "start",
    showTitle: true,
    showSource: false,
    showUpdatedAt: false,
    decimalPlaces: 2,
    unit: "",
    contentDensity: "comfortable",
  },
  ops_overview_kpis: {
    variant: "full",
    verticalAlign: "stretch",
    showTitle: true,
    showSource: false,
    showUpdatedAt: false,
    decimalPlaces: 0,
    unit: "",
    contentDensity: "compact",
  },
  ops_device_table: {
    variant: "standard",
    verticalAlign: "stretch",
    showTitle: true,
    showSource: false,
    showUpdatedAt: false,
    decimalPlaces: 0,
    unit: "",
    contentDensity: "compact",
  },
  ops_recent_activity: {
    variant: "standard",
    verticalAlign: "start",
    showTitle: true,
    showSource: false,
    showUpdatedAt: false,
    decimalPlaces: 0,
    unit: "",
    contentDensity: "compact",
  },
  ops_recent_alerts: {
    variant: "standard",
    verticalAlign: "start",
    showTitle: true,
    showSource: false,
    showUpdatedAt: false,
    decimalPlaces: 0,
    unit: "",
    contentDensity: "compact",
  },
  ops_alert_trends: {
    variant: "full",
    verticalAlign: "stretch",
    showTitle: true,
    showSource: false,
    showUpdatedAt: false,
    decimalPlaces: 0,
    unit: "",
    contentDensity: "compact",
  },
};

export function resolveWidgetPresentation(block: DashboardLiveWidgetDTO): ResolvedWidgetPresentation {
  const t = block.type || "unknown";
  const defaults: ResolvedWidgetPresentation = {
    variant: "standard",
    verticalAlign: "stretch",
    showTitle: true,
    showSource: false,
    showUpdatedAt: false,
    decimalPlaces: 2,
    unit: "",
    contentDensity: "comfortable",
    ...DEFAULTS_BY_TYPE[t],
  };
  const over = mergePresentationLayer(presentationSources(block));
  const dec = over.decimalPlaces;
  return {
    variant: over.variant ?? defaults.variant,
    verticalAlign: over.verticalAlign ?? defaults.verticalAlign,
    showTitle: over.showTitle ?? defaults.showTitle,
    showSource: over.showSource ?? defaults.showSource,
    showUpdatedAt: over.showUpdatedAt ?? defaults.showUpdatedAt,
    decimalPlaces:
      dec !== undefined ? Math.max(0, Math.min(12, Math.floor(dec))) : defaults.decimalPlaces,
    unit: over.unit !== undefined ? over.unit : defaults.unit,
    contentDensity: over.contentDensity ?? defaults.contentDensity,
  };
}

export type WidgetRenderState = "normal" | "loading" | "empty" | "error" | "degraded";

/** Frame chrome: degraded banner is handled outside the frame (DashboardWidgetView). */
export type WidgetFrameState = "normal" | "loading" | "empty" | "error";

export function inferWidgetRenderState(
  block: DashboardLiveWidgetDTO,
  opts?: { hasRenderableContent?: boolean; forceEmpty?: boolean },
): WidgetRenderState {
  const d = block.data ?? {};
  if (typeof d.error === "string" && d.error.trim()) return "error";
  if (d.degraded === true) return "degraded";
  if (opts?.forceEmpty) return "empty";
  if (opts?.hasRenderableContent === false) return "empty";
  return "normal";
}

/** Format numeric-like values for KPI / table cells. */
export function formatDashboardValue(
  value: unknown,
  presentation: Pick<ResolvedWidgetPresentation, "decimalPlaces" | "unit">,
): string {
  if (value === null || value === undefined) return "—";
  const u = presentation.unit?.trim() ?? "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const dp = presentation.decimalPlaces;
    const s =
      dp === 0
        ? String(Math.round(value))
        : value.toLocaleString(undefined, {
            maximumFractionDigits: dp,
            minimumFractionDigits: Math.min(dp, 2),
          });
    return u ? `${s} ${u}` : s;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const str = String(value);
  return u && str !== "—" ? `${str} ${u}` : str;
}
