import type { ReactNode } from "react";
import { DashboardResizeManager } from "./DashboardResizeManager";

/** Visual + interaction mode for shared runtime CSS (Grafana-style layer). */
export type DashboardRuntimeVariant = "live" | "builder" | "enterprise";

type Props = {
  children: ReactNode;
  /** Matches live dashboard one-screen fit (flex column fill). */
  fitPage?: boolean;
  /** `live` / `enterprise`: no card hover polish. `builder`: preview panel — subtle hover only. */
  variant?: DashboardRuntimeVariant;
};

/**
 * Top-level dashboard runtime chrome: resize observation + layout class hooks.
 */
export function DashboardRuntimeShell({
  children,
  fitPage = true,
  variant = "live",
}: Props) {
  return (
    <DashboardResizeManager
      className={["dashboard-runtime", `dashboard-runtime--${variant}`, fitPage ? "dashboard-runtime--fit-page" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </DashboardResizeManager>
  );
}
