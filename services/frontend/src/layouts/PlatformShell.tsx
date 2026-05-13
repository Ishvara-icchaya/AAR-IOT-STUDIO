import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { OpsContextBar } from "@/components/ops/OpsContextBar";
import { OpsShellProvider } from "@/contexts/OpsShellContext";
import { SitePermissionsProvider } from "@/contexts/SitePermissionsContext";
import { dbg } from "@/lib/debug";
import { FooterBar } from "./shell/FooterBar";
import { HeaderBar } from "./shell/HeaderBar";
import { ResourceInUseProvider } from "@/contexts/ResourceInUseContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { WorkspaceInboxModal } from "@/components/workspace/WorkspaceInboxModal";
import { ShellMessageProvider } from "./shell/ShellMessageContext";
import { titleFromPath } from "./shell/navigation";

export function PlatformShell() {
  const { pathname } = useLocation();
  const headerTitle = titleFromPath(pathname);
  /** Manage Devices renders its own title, scope controls, and actions to match the dashboard mock. */
  const hideShellPageChrome =
    pathname === "/devices/register" ||
    pathname === "/devices/lineage" ||
    pathname.startsWith("/devices/ingest") ||
    pathname.startsWith("/scrubber/v2") ||
    pathname.startsWith("/workflow") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/enterprise-ai") ||
    pathname === "/administration/monitoring" ||
    pathname === "/administration/users" ||
    pathname === "/administration/sites" ||
    pathname === "/administration/site-access" ||
    pathname === "/administration/audit";

  useEffect(() => {
    dbg("PlatformShell mount", pathname);
  }, [pathname]);

  return (
    <ShellMessageProvider>
      <ResourceInUseProvider>
      <OpsShellProvider>
        <SitePermissionsProvider>
        <WorkspaceProvider>
        <WorkspaceInboxModal />
        <div className="shell shell--app shell--ops">
          <HeaderBar />
          <div className="shell__below-header">
            <div className="shell__main shell__main--with-footer">
              {!hideShellPageChrome ? (
                <>
                  <div className="shell__pagebar">
                    <strong className="shell__page-title">{headerTitle}</strong>
                  </div>
                  <OpsContextBar />
                </>
              ) : null}
              <main className="shell__content">
                <Outlet />
              </main>
            </div>
            <FooterBar />
          </div>
        </div>
        </WorkspaceProvider>
        </SitePermissionsProvider>
      </OpsShellProvider>
      </ResourceInUseProvider>
    </ShellMessageProvider>
  );
}
