import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchResolvedDeviceCollection, type ResolvedDeviceCollectionRuntimeResponse } from "@/api/dashboard";
import type { DashboardWidgetBinding2, DashboardWidgetInstance2 } from "@/types/dashboard2";

export type Dashboard2RuntimeDataState = {
  loading: boolean;
  error: string | null;
  data: ResolvedDeviceCollectionRuntimeResponse | null;
  /** ISO timestamp of last successful fetch for this binding (shared across widgets with the same binding). */
  lastFetchedAt: string | null;
};

type RuntimeDataMap = Record<string, Dashboard2RuntimeDataState>;

const DashboardRuntimeDataContext = createContext<RuntimeDataMap>({});

export function getBindingKey(binding: DashboardWidgetBinding2): string {
  return JSON.stringify(binding);
}

export function widgetBindingUsesResolvedCollection(
  binding: DashboardWidgetBinding2,
): binding is Extract<DashboardWidgetBinding2, { sourceType: "resolved_device_collection" }> {
  return binding.sourceType === "resolved_device_collection";
}

export function DashboardRuntimeDataProvider({
  widgets,
  refreshVersion = 0,
  children,
}: {
  widgets: DashboardWidgetInstance2[];
  /** Increment (e.g. live shell auto-refresh tick) to re-run resolved-collection fetches. */
  refreshVersion?: number;
  children: ReactNode;
}) {
  const [state, setState] = useState<RuntimeDataMap>({});

  const keys = useMemo(() => {
    const uniq = new Map<string, { binding: DashboardWidgetBinding2; types: Set<string> }>();
    widgets.forEach((w) => {
      const k = getBindingKey(w.binding);
      if (!widgetBindingUsesResolvedCollection(w.binding)) return;
      if (!uniq.has(k)) uniq.set(k, { binding: w.binding, types: new Set() });
      uniq.get(k)!.types.add(w.type);
    });
    return Array.from(uniq.entries());
  }, [widgets]);

  useEffect(() => {
    let cancelled = false;
    keys.forEach(([key]) => {
      setState((prev) => ({
        ...prev,
        [key]: {
          loading: true,
          error: null,
          data: prev[key]?.data ?? null,
          lastFetchedAt: prev[key]?.lastFetchedAt ?? null,
        },
      }));
    });

    void Promise.all(
      keys.map(async ([key, { binding, types }]) => {
        if (!widgetBindingUsesResolvedCollection(binding)) {
          if (!cancelled) {
            setState((prev) => ({
              ...prev,
              [key]: { loading: false, error: null, data: null, lastFetchedAt: prev[key]?.lastFetchedAt ?? null },
            }));
          }
          return;
        }
        const onlyMap = types.size === 1 && types.has("location_heading_map");
        try {
          const data = await fetchResolvedDeviceCollection({
            siteId: binding.siteId,
            endpointId: binding.endpointId,
            objectName: binding.objectName,
            lifecycleStatus: binding.filters?.lifecycleStatus?.[0],
            healthStatus: binding.filters?.healthStatus?.[0],
            deviceType: binding.filters?.deviceType?.[0],
            requireLocation: onlyMap,
          });
          const ts = new Date().toISOString();
          if (!cancelled) setState((prev) => ({ ...prev, [key]: { loading: false, error: null, data, lastFetchedAt: ts } }));
        } catch (e) {
          if (!cancelled) {
            setState((prev) => ({
              ...prev,
              [key]: {
                loading: false,
                error: e instanceof Error ? e.message : "Failed to fetch runtime data",
                data: null,
                lastFetchedAt: prev[key]?.lastFetchedAt ?? null,
              },
            }));
          }
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [keys, refreshVersion]);

  return <DashboardRuntimeDataContext.Provider value={state}>{children}</DashboardRuntimeDataContext.Provider>;
}

export function useDashboardWidgetRuntimeData(binding: DashboardWidgetBinding2): Dashboard2RuntimeDataState {
  const ctx = useContext(DashboardRuntimeDataContext);
  const key = getBindingKey(binding);
  return ctx[key] ?? { loading: false, error: null, data: null, lastFetchedAt: null };
}
