import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Bell, Map as MapIcon, LineChart } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type CenterView = "map" | "analytics";

export function IotHeader({
  centerView,
  onCenterViewChange,
}: {
  centerView: CenterView;
  onCenterViewChange: (v: CenterView) => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-cyan-500/20 bg-background/80 px-4 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-muted-foreground" asChild>
          <Link to="/enterprise-dashboard">
            <ArrowLeft className="size-4" />
            Studio
          </Link>
        </Button>
        <div className="hidden h-6 w-px bg-border sm:block" />
        <div className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.h1
              key={centerView}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.2 }}
              className="truncate text-sm font-semibold text-foreground md:text-base"
            >
              {centerView === "map" ? "Fleet map" : "Operations analytics"}
            </motion.h1>
          </AnimatePresence>
          <p className="hidden text-xs text-muted-foreground sm:block">Industrial control center · mock data</p>
        </div>
      </div>

      <Tabs value={centerView} onValueChange={(v) => onCenterViewChange(v as CenterView)} className="shrink-0">
        <TabsList className="h-9">
          <TabsTrigger value="map" className="gap-1.5 px-3 text-xs sm:text-sm">
            <MapIcon className="size-3.5" />
            Map
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-1.5 px-3 text-xs sm:text-sm">
            <LineChart className="size-3.5" />
            Analytics
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="icon" className="relative border-cyan-500/25">
          <Bell className="size-4" />
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_hsl(187_100%_50%)]" />
        </Button>
        <div className="hidden items-center gap-2 rounded-lg border border-cyan-500/20 bg-muted/40 px-2 py-1 sm:flex">
          <div className="size-7 rounded-full bg-gradient-to-br from-cyan-400/40 to-primary/50 ring-2 ring-cyan-500/30" />
          <div className="text-left text-xs">
            <p className="font-medium text-foreground">Operator</p>
            <p className="text-muted-foreground">North region</p>
          </div>
        </div>
      </div>
    </header>
  );
}
