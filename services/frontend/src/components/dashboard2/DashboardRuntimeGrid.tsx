import { Responsive } from "react-grid-layout";
import { useEffect, useState, type ReactNode } from "react";
import type { DashboardDefinition2 } from "@/types/dashboard2";
import { DashboardWidgetCard } from "./DashboardWidgetCard";
import { DashboardWidgetRuntimeRenderer2 } from "./DashboardWidgetRuntimeRenderer";
import {
  DashboardRuntimeDataProvider,
  useDashboardWidgetRuntimeData,
  widgetBindingUsesResolvedCollection,
} from "./DashboardRuntimeDataProvider";
import "./dashboard2.css";

function formatClock(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

export function DashboardRuntimeGrid({
  dashboard,
  mode,
  refreshVersion = 0,
}: {
  dashboard: DashboardDefinition2;
  mode: "preview" | "live";
  refreshVersion?: number;
}) {
  const [width, setWidth] = useState<number>(typeof window === "undefined" ? 1280 : window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <DashboardRuntimeDataProvider widgets={dashboard.widgets} refreshVersion={refreshVersion}>
      <section className={`dashboard-${mode}`}>
        <Responsive
          width={width}
          layouts={dashboard.layouts}
          breakpoints={{ lg: 1200, md: 900, sm: 600 }}
          cols={{ lg: 12, md: 8, sm: 4 }}
          rowHeight={40}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          dragConfig={{ enabled: false }}
          resizeConfig={{ enabled: false }}
        >
          {dashboard.widgets.map((widget) => (
            <WidgetRuntimeCard key={widget.id} widget={widget} mode={mode} />
          ))}
        </Responsive>
      </section>
    </DashboardRuntimeDataProvider>
  );
}

function WidgetRuntimeCard({
  widget,
  mode,
}: {
  widget: DashboardDefinition2["widgets"][number];
  mode: "preview" | "live";
}) {
  const runtime = useDashboardWidgetRuntimeData(widget.binding);
  const needs = widgetBindingUsesResolvedCollection(widget.binding);
  const refreshed = needs && runtime.lastFetchedAt ? formatClock(runtime.lastFetchedAt) : "";

  let body: ReactNode;
  if (needs) {
    if (runtime.loading) {
      body = <div className="dashboard2-widget-state dashboard2-widget-state--loading">Loading…</div>;
    } else if (runtime.error) {
      body = (
        <div className="dashboard2-widget-state dashboard2-widget-state--error" role="alert">
          {runtime.error}
        </div>
      );
    } else if (
      runtime.data &&
      widget.type === "data_table" &&
      (!runtime.data.items || runtime.data.items.length === 0)
    ) {
      body = (
        <div className="dashboard2-widget-state dashboard2-widget-state--empty">
          No devices in this endpoint group for the current filters.
        </div>
      );
    } else {
      body = <DashboardWidgetRuntimeRenderer2 widget={widget} data={runtime.data} mode={mode} />;
    }
  } else {
    body = <DashboardWidgetRuntimeRenderer2 widget={widget} data={runtime.data} mode={mode} />;
  }

  return (
    <div key={widget.id}>
      <DashboardWidgetCard
        title={widget.title}
        subtitle={widget.description}
        actions={
          refreshed ? (
            <time className="dashboard2-widget-refreshed" dateTime={runtime.lastFetchedAt ?? undefined}>
              Updated {refreshed}
            </time>
          ) : null
        }
      >
        {body}
      </DashboardWidgetCard>
    </div>
  );
}
