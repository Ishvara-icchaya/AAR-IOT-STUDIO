import type { DashboardLiveWidgetDTO } from "@/types/dashboard";

/** Frame-level live widget state (error / degraded) — parsed once per block. */
export type LiveWidgetShellVM = {
  error: string | null;
  degraded: boolean;
  warning: string;
  sourceMissing: boolean;
};

export function adaptLiveWidgetShell(block: DashboardLiveWidgetDTO): LiveWidgetShellVM {
  const d = block.data && typeof block.data === "object" ? (block.data as Record<string, unknown>) : {};
  const err = d.error;
  return {
    error: typeof err === "string" && err.trim() ? err : null,
    degraded: d.degraded === true,
    warning: typeof d.warning === "string" ? d.warning : "",
    sourceMissing: d.source_missing === true,
  };
}
