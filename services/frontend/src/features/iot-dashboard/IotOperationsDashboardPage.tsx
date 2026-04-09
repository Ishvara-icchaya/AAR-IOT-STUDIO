import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { IotHeader, type CenterView } from "./shell/IotHeader";
import { IotRightPanel } from "./shell/IotRightPanel";
import { IotSidebar } from "./shell/IotSidebar";
import { AnalyticsCenterView } from "./views/AnalyticsCenterView";
import { MapCenterView } from "./views/MapCenterView";
import "./iot-dashboard-theme.css";

/**
 * Full-viewport IoT operations console (Tailwind + shadcn-style primitives scoped to #iot-dashboard-root).
 * Route: `/iot-dashboard` — outside PlatformShell for dedicated NOC layout.
 */
export function IotOperationsDashboardPage() {
  const [centerView, setCenterView] = useState<CenterView>("map");

  return (
    <div
      id="iot-dashboard-root"
      className="fixed inset-0 z-[200] flex min-h-0 flex-col bg-background text-foreground antialiased"
    >
      <IotHeader centerView={centerView} onCenterViewChange={setCenterView} />
      <div className="flex min-h-0 flex-1">
        <IotSidebar />
        <main className="relative min-h-0 min-w-0 flex-1 p-3 md:p-4">
          <AnimatePresence mode="wait">
            {centerView === "map" ? (
              <motion.div
                key="map"
                role="tabpanel"
                initial={{ opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.985 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="flex h-full min-h-0"
              >
                <MapCenterView />
              </motion.div>
            ) : (
              <motion.div
                key="analytics"
                role="tabpanel"
                initial={{ opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.985 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="flex h-full min-h-0 flex-col"
              >
                <AnalyticsCenterView />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
        <IotRightPanel />
      </div>
    </div>
  );
}
