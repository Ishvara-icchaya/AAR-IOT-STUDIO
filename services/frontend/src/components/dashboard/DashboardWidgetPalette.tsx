import { useDraggable } from "@dnd-kit/core";
import { PALETTE_WIDGET_TYPES } from "@/lib/dashboardDefaults";

function PaletteItem({ type }: { type: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${type}`,
    data: { type: "palette", widgetType: type },
  });
  const label = type.replace(/_/g, " ");
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`dash-palette__item${isDragging ? " dash-palette__item--dragging" : ""}`}
    >
      {label}
    </button>
  );
}

export function DashboardWidgetPalette() {
  return (
    <aside className="dash-palette">
      <h2 className="dash-palette__title">Widgets</h2>
      <p className="dash-palette__hint">Drag into a column slot.</p>
      <div className="dash-palette__list">
        {PALETTE_WIDGET_TYPES.map((t) => (
          <PaletteItem key={t} type={t} />
        ))}
      </div>
    </aside>
  );
}
