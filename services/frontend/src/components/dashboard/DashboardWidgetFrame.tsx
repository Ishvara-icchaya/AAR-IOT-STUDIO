import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import type { ResolvedWidgetPresentation, WidgetFrameState } from "@/lib/widgetPresentation";
import "./dashboardWidgetFrame.css";

type Props = {
  block: DashboardLiveWidgetDTO;
  presentation: ResolvedWidgetPresentation;
  state: WidgetFrameState;
  /** Primary content (hidden when error/empty/loading) */
  children?: ReactNode;
  /** Optional subtitle under title (e.g. chart axes) */
  subtitle?: ReactNode;
  /** Single line source / binding summary when showSource */
  sourceLine?: string | null;
  /** Footer: updated timestamp when showUpdatedAt */
  updatedAtLine?: string | null;
  /** Extra header actions (e.g. map expand) */
  headerExtra?: ReactNode;
  /** Left accent border (KPI health) */
  accentBorderColor?: string;
  accentBorderWidth?: number;
  /** BEM modifier for widget kind: dash-wf--kpi */
  widgetKind: string;
  className?: string;
  /** Custom empty message */
  emptyMessage?: string;
  /** Custom error message */
  errorMessage?: string;
  loadingMessage?: string;
  /** When true, body fills remaining space (charts, maps, tables) */
  bodyFill?: boolean;
  /** e.g. map expanded: role="dialog", aria-modal */
  rootProps?: HTMLAttributes<HTMLDivElement>;
  /** Merged onto root (e.g. device tile border) */
  rootStyle?: CSSProperties;
};

export function DashboardWidgetFrame({
  block,
  presentation,
  state,
  children,
  subtitle,
  sourceLine,
  updatedAtLine,
  headerExtra,
  accentBorderColor,
  accentBorderWidth = 3,
  widgetKind,
  className = "",
  emptyMessage = "No data",
  errorMessage,
  loadingMessage = "Loading…",
  bodyFill = false,
  rootProps,
  rootStyle,
}: Props) {
  const { className: rootClassExtra, ...rootRest } = rootProps ?? {};
  const { variant, verticalAlign, showTitle, showSource, showUpdatedAt, contentDensity } = presentation;
  const title = block.title?.trim() || "Widget";

  const borderStyle =
    accentBorderColor && state === "normal"
      ? {
          borderLeftWidth: accentBorderWidth,
          borderLeftStyle: "solid" as const,
          borderLeftColor: accentBorderColor,
        }
      : undefined;

  const showMetaRow =
    state === "normal" &&
    (showSource || showUpdatedAt) &&
    (sourceLine || updatedAtLine);

  const showHeaderChrome = showTitle && (state === "normal" || state === "error" || state === "empty" || state === "loading");

  return (
    <div
      {...rootRest}
      className={[
        "dash-widget",
        "dash-wf",
        `dash-wf--${variant}`,
        `dash-wf--density-${contentDensity}`,
        `dash-wf--align-${verticalAlign}`,
        `dash-wf--${widgetKind}`,
        bodyFill ? "dash-wf--fill" : "",
        state !== "normal" ? `dash-wf--state-${state}` : "",
        className,
        rootClassExtra,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ...borderStyle, ...rootStyle }}
    >
      {showHeaderChrome ? (
        <header className="dash-wf__header">
          <div className="dash-wf__header-main">
            <h3 className="dash-wf__title">{title}</h3>
            {state === "normal" && headerExtra ? <div className="dash-wf__header-actions">{headerExtra}</div> : null}
          </div>
          {state === "normal" && subtitle ? <div className="dash-wf__subtitle">{subtitle}</div> : null}
          {showMetaRow ? (
            <div className="dash-wf__meta">
              {showSource && sourceLine ? <span className="dash-wf__meta-item">{sourceLine}</span> : null}
              {showUpdatedAt && updatedAtLine ? (
                <span className="dash-wf__meta-item dash-wf__meta-item--muted">{updatedAtLine}</span>
              ) : null}
            </div>
          ) : null}
        </header>
      ) : null}

      <div className={`dash-wf__body ${bodyFill ? "dash-wf__body--fill" : ""}`}>
        {state === "loading" ? (
          <div className="dash-wf__state dash-wf__state--loading" role="status">
            {loadingMessage}
          </div>
        ) : null}
        {state === "error" ? (
          <div className="dash-wf__state dash-wf__state--error" role="alert">
            {errorMessage ?? "Something went wrong"}
          </div>
        ) : null}
        {state === "empty" ? (
          <div className="dash-wf__state dash-wf__state--empty" role="status">
            {emptyMessage}
          </div>
        ) : null}
        {state === "normal" ? children : null}
      </div>
    </div>
  );
}
