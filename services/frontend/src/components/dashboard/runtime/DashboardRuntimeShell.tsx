import type { ReactNode } from "react";
import { DashboardResizeManager } from "./DashboardResizeManager";

type Props = {
  children: ReactNode;
  /** Matches live dashboard one-screen fit (flex column fill). */
  fitPage?: boolean;
};

/**
 * Top-level dashboard runtime chrome: resize observation + layout class hooks.
 */
export function DashboardRuntimeShell({ children, fitPage = true }: Props) {
  return (
    <DashboardResizeManager
      className={["dashboard-runtime", fitPage ? "dashboard-runtime--fit-page" : ""].filter(Boolean).join(" ")}
    >
      {children}
    </DashboardResizeManager>
  );
}
