import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { OpsContextBar } from "@/components/ops/OpsContextBar";
import { OpsShellProvider } from "@/contexts/OpsShellContext";
import { dbg } from "@/lib/debug";
import { FooterBar } from "./shell/FooterBar";
import { HeaderBar } from "./shell/HeaderBar";
import { PageMessageBar } from "./shell/PageMessageBar";
import { ResourceInUseProvider } from "@/contexts/ResourceInUseContext";
import { ShellMessageProvider } from "./shell/ShellMessageContext";
import { titleFromPath } from "./shell/navigation";

export function PlatformShell() {
  const { pathname } = useLocation();
  const headerTitle = titleFromPath(pathname);

  useEffect(() => {
    dbg("PlatformShell mount", pathname);
  }, [pathname]);

  return (
    <ShellMessageProvider>
      <ResourceInUseProvider>
      <OpsShellProvider>
        <div className="shell shell--app shell--ops">
          <HeaderBar />
          <div className="shell__below-header">
            <PageMessageBar />
            <div className="shell__main shell__main--with-footer">
              <div className="shell__pagebar">
                <strong className="shell__page-title">{headerTitle}</strong>
              </div>
              <OpsContextBar />
              <main className="shell__content">
                <Outlet />
              </main>
            </div>
            <FooterBar />
          </div>
        </div>
      </OpsShellProvider>
      </ResourceInUseProvider>
    </ShellMessageProvider>
  );
}
