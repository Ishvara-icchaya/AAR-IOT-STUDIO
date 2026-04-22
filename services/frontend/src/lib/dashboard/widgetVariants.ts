import type { ResolvedWidgetPresentation, WidgetVariant } from "@/lib/widgetPresentation";

/** Maps presentation variant to chart density profile. */
export function chartVariantToGrid(
  v: WidgetVariant,
): "compact" | "standard" | "full" {
  if (v === "compact") return "compact";
  if (v === "full") return "full";
  return "standard";
}

export function tableVariantToAgMode(
  pres: ResolvedWidgetPresentation,
): "dense" | "standard" | "full" {
  if (pres.contentDensity === "dense" || pres.variant === "dense") return "dense";
  if (pres.variant === "full") return "full";
  return "standard";
}

export function isCompactPresentation(pres: ResolvedWidgetPresentation): boolean {
  return pres.variant === "compact" || pres.contentDensity === "compact";
}
