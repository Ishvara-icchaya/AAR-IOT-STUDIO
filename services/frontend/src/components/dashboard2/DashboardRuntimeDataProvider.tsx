import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchResolvedDeviceCollection, type ResolvedDeviceCollectionRuntimeResponse } from "@/api/dashboard";
import type { DashboardWidgetBinding2, DashboardWidgetInstance2 } from "@/types/dashboard2";

type RuntimeDataState = {
  loading: boolean;
  error: string | null;
  data: ResolvedDeviceCollectionRuntimeResponse | null;
};

type RuntimeDataMap = Record<string, RuntimeDataState>;

const DashboardRuntimeDataContext = createContext<RuntimeDataMap>({});

export function getBindingKey(binding: DashboardWidgetBinding2): string {
  return JSON.stringify(binding);
}

function needsResolvedCollection(binding: DashboardWidgetBinding2): binding is Extract<DashboardWidgetBinding2, { sourceType: "resolved_device_collection" }> {
  return binding.sourceType === "resolved_device_collection";
}

export function DashboardRuntimeDataProvider({
  widgets,
  children,
}: {
  widgets: DashboardWidgetInstance2[];
  children: ReactNode;
}) {
  const [state, setState] = useState<RuntimeDataMap>({});

  const keys = useMemo(() => {
    const uniq = new Map<string, DashboardWidgetBinding2>();
    widgets.forEach((w) => {
      const k = getBindingKey(w.binding);
      if (!uniq.has(k)) uniq.set(k, w.binding);
    });
    return Array.from(uniq.entries());
  }, [widgets]);

  useEffect(() => {
    let cancelled = false;
    keys.forEach(([key]) => {
      setState((prev) => ({ ...prev, [key]: { loading: true, error: null, data: prev[key]?.data ?? null } }));
    });

    void Promise.all(
      keys.map(async ([key, binding]) => {
        if (!needsResolvedCollection(binding)) {
          if (!cancelled) {
            setState((prev) => ({ ...prev, [key]: { loading: false, error: null, data: null } }));
          }
          return;
        }
        try {
          const data = await fetchResolvedDeviceCollection({
            siteId: binding.siteId,
            endpointId: binding.endpointId,
            objectName: binding.objectName,
            lifecycleStatus: binding.filters?.lifecycleStatus?.[0],
            healthStatus: binding.filters?.healthStatus?.[0],
            deviceType: binding.filters?.deviceType?.[0],
          });
          if (!cancelled) setState((prev) => ({ ...prev, [key]: { loading: false, error: null, data } }));
        } catch (e) {
          if (!cancelled) {
            setState((prev) => ({
              ...prev,
              [key]: { loading: false, error: e instanceof Error ? e.message : "Failed to fetch runtime data", data: null },
            }));
          }
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [keys]);

  return <DashboardRuntimeDataContext.Provider value={state}>{children}</DashboardRuntimeDataContext.Provider>;
}

export function useDashboardWidgetRuntimeData(binding: DashboardWidgetBinding2): RuntimeDataState {
  const ctx = useContext(DashboardRuntimeDataContext);
  const key = getBindingKey(binding);
  return ctx[key] ?? { loading: false, error: null, data: null };
}
