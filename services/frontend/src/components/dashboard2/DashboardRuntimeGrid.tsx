import { Responsive, WidthProvider } from "react-grid-layout";
import type { DashboardDefinition2 } from "@/types/dashboard2";
import { DashboardWidgetCard } from "./DashboardWidgetCard";
import { DashboardWidgetRuntimeRenderer2 } from "./DashboardWidgetRuntimeRenderer";
import "./dashboard2.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

export function DashboardRuntimeGrid({
  dashboard,
  mode,
}: {
  dashboard: DashboardDefinition2;
  mode: "preview" | "live";
}) {
  return (
    <section className={`dashboard-${mode}`}>
      <ResponsiveGridLayout
        layouts={dashboard.layouts}
        breakpoints={{ lg: 1200, md: 900, sm: 600 }}
        cols={{ lg: 12, md: 8, sm: 4 }}
        rowHeight={40}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={false}
        isResizable={false}
        measureBeforeMount={false}
      >
        {dashboard.widgets.map((widget) => (
          <div key={widget.id}>
            <DashboardWidgetCard title={widget.title} subtitle={widget.description}>
              <DashboardWidgetRuntimeRenderer2 widget={widget} data={null} mode={mode} />
            </DashboardWidgetCard>
          </div>
        ))}
      </ResponsiveGridLayout>
    </section>
  );
}
