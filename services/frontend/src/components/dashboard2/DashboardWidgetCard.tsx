import type { ReactNode } from "react";

export function DashboardWidgetCard({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="dashboard-widget-card">
      <header className="dashboard-widget-card__header">
        <div className="dashboard-widget-card__title-wrap">
          <h3 className="dashboard-widget-card__title">{title}</h3>
          {subtitle ? <p className="dashboard-widget-card__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="dashboard-widget-card__actions">{actions}</div> : null}
      </header>
      <div className="dashboard-widget-card__body">{children}</div>
    </article>
  );
}
