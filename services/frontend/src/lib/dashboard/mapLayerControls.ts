/**
 * Map widget layer / color / filter controls (expanded map + deck overlay).
 * Persisted under widget `config.mapLayerControls` when saved from the builder.
 */

import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import type { MarkerRec } from "@/lib/dashboard/adapters/apiMarkersToRec";

export type MapLayerColorMode = "health" | "group" | "device";
export type MapLayerFilterMode = "all" | "stale" | "offline";

export type MapLayerControls = {
  showLiveMarkers: boolean;
  showAggregatedDeviceMarkers: boolean;
  showEndpointGroups: boolean;
  showHistoricalPath: boolean;
  showReplayHead: boolean;
  showGapPoints: boolean;
  showStartEndAnchors: boolean;
  showLabels: boolean;
  colorMode: MapLayerColorMode;
  filterMode: MapLayerFilterMode;
};

export const DEFAULT_MAP_LAYER_CONTROLS: MapLayerControls = {
  showLiveMarkers: true,
  showAggregatedDeviceMarkers: true,
  showEndpointGroups: true,
  showHistoricalPath: true,
  showReplayHead: true,
  showGapPoints: true,
  showStartEndAnchors: true,
  showLabels: false,
  colorMode: "health",
  filterMode: "all",
};

function readBool(v: unknown, fallback: boolean): boolean {
  if (v === true || v === false) return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return fallback;
}

function readColorMode(v: unknown): MapLayerColorMode {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "group" || s === "endpoint_group" || s === "endpoint_groups") return "group";
  if (s === "device") return "device";
  return "health";
}

function readFilterMode(v: unknown): MapLayerFilterMode {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "stale") return "stale";
  if (s === "offline") return "offline";
  return "all";
}

export function mergeMapLayerControls(partial: unknown): MapLayerControls {
  const base = { ...DEFAULT_MAP_LAYER_CONTROLS };
  if (!partial || typeof partial !== "object") return base;
  const p = partial as Record<string, unknown>;
  return {
    showLiveMarkers: readBool(p.showLiveMarkers ?? p.show_live_markers, base.showLiveMarkers),
    showAggregatedDeviceMarkers: readBool(
      p.showAggregatedDeviceMarkers ?? p.show_aggregated_device_markers,
      base.showAggregatedDeviceMarkers,
    ),
    showEndpointGroups: readBool(p.showEndpointGroups ?? p.show_endpoint_groups, base.showEndpointGroups),
    showHistoricalPath: readBool(p.showHistoricalPath ?? p.show_historical_path, base.showHistoricalPath),
    showReplayHead: readBool(p.showReplayHead ?? p.show_replay_head, base.showReplayHead),
    showGapPoints: readBool(p.showGapPoints ?? p.show_gap_points, base.showGapPoints),
    showStartEndAnchors: readBool(p.showStartEndAnchors ?? p.show_start_end_anchors, base.showStartEndAnchors),
    showLabels: readBool(p.showLabels ?? p.show_labels, base.showLabels),
    colorMode: readColorMode(p.colorMode ?? p.color_mode),
    filterMode: readFilterMode(p.filterMode ?? p.filter_mode),
  };
}

export function parseMapLayerControlsFromBlock(block: DashboardLiveWidgetDTO): MapLayerControls {
  const fromConfig = block.config?.mapLayerControls ?? block.config?.map_layer_controls;
  const fromData = block.data?.map_layer_controls ?? block.data?.mapLayerControls;
  const merged = mergeMapLayerControls(fromConfig);
  if (fromData && typeof fromData === "object") {
    return mergeMapLayerControls({ ...merged, ...(fromData as Record<string, unknown>) });
  }
  return merged;
}

function isAggregatedFeedMarker(m: MarkerRec): boolean {
  return (m.display_name ?? "").includes(" feeds)");
}

function isGroupMarker(m: MarkerRec): boolean {
  return m.marker_group_index != null && Number.isFinite(m.marker_group_index);
}

function healthBucket(h: string | undefined): "stale" | "offline" | "other" {
  const s = (h ?? "").trim().toLowerCase();
  if (s === "offline" || s === "gray" || s === "grey") return "offline";
  if (s === "yellow" || s === "late" || s === "stale" || s === "degraded" || s === "warning") return "stale";
  return "other";
}

export function filterMarkersForLayers(markers: MarkerRec[], lc: MapLayerControls): MarkerRec[] {
  let out = markers.filter((m) => {
    const agg = isAggregatedFeedMarker(m);
    const grp = isGroupMarker(m);
    if (agg && !lc.showAggregatedDeviceMarkers) return false;
    if (grp && !lc.showEndpointGroups) return false;
    if (!grp && !agg && !lc.showLiveMarkers) return false;
    return true;
  });
  if (lc.filterMode === "stale") {
    out = out.filter((m) => healthBucket(m.health_status) === "stale");
  } else if (lc.filterMode === "offline") {
    out = out.filter((m) => healthBucket(m.health_status) === "offline");
  }
  return out;
}

export function stableHueFromString(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h = Math.imul(h ^ token.charCodeAt(i), 16777619);
  }
  return Math.abs(h) % 360;
}
