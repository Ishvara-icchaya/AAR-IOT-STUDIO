import { Responsive } from "react-grid-layout";
import type { Layout, ResponsiveLayouts } from "react-grid-layout";
import { useEffect, useState } from "react";
import type { DashboardDefinition2 } from "@/types/dashboard2";
import { DashboardWidgetCard } from "./DashboardWidgetCard";
import { DashboardWidgetRuntimeRenderer2 } from "./DashboardWidgetRuntimeRenderer";

export function DashboardDesignerGrid({
  dashboard,
  onLayoutsChange,
}: {
  dashboard: DashboardDefinition2;
  onLayoutsChange?: (layouts: ResponsiveLayouts) => void;
}) {
  const [width, setWidth] = useState<number>(typeof window === "undefined" ? 1280 : window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <section className="dashboard-designer">
      <Responsive
        width={width}
        layouts={dashboard.layouts}
        breakpoints={{ lg: 1200, md: 900, sm: 600 }}
        cols={{ lg: 12, md: 8, sm: 4 }}
        rowHeight={40}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        dragConfig={{ enabled: true }}
        resizeConfig={{ enabled: true }}
        onLayoutChange={(_: Layout, allLayouts: ResponsiveLayouts) => onLayoutsChange?.(allLayouts)}
      >
        {dashboard.widgets.map((widget) => (
          <div key={widget.id}>
            <DashboardWidgetCard title={widget.title} subtitle={widget.description}>
              <DashboardWidgetRuntimeRenderer2 widget={widget} data={null} mode="designer" />
            </DashboardWidgetCard>
          </div>
        ))}
      </Responsive>
    </section>
  );
}
