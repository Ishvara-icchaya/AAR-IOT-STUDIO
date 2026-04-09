import { motion } from "framer-motion";
import { Crosshair, MapPin } from "lucide-react";
import { KpiGlassCard } from "../components/KpiGlassCard";
import { AlarmStrip } from "../components/AlarmStrip";
import { MOCK_ALARMS, MOCK_KPIS } from "../mockData";

export function MapCenterView() {
  const mapKpis = MOCK_KPIS.slice(0, 3);

  return (
    <div className="relative flex h-full min-h-[420px] flex-1 flex-col overflow-hidden rounded-xl border border-cyan-500/20 bg-background shadow-inner">
      {/* Map placeholder — industrial dark canvas */}
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,hsl(187_80%_12%/0.35),transparent_50%),radial-gradient(ellipse_at_70%_80%,hsl(220_60%_18%/0.25),transparent_45%),linear-gradient(165deg,hsl(222_47%_6%)_0%,hsl(222_40%_8%)_40%,hsl(220_45%_5%)_100%)]"
        aria-hidden
      />
      <div
        className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(hsl(187_100%_50%)_1px,transparent_1px),linear-gradient(90deg,hsl(187_100%_50%)_1px,transparent_1px)] [background-size:48px_48px]"
        aria-hidden
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" aria-hidden />

      <div className="relative z-10 flex h-full flex-col p-4 md:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-cyan-500/25 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-md">
            <Crosshair className="size-3.5 text-cyan-400" />
            <span>
              Live fleet map · <span className="font-mono text-cyan-200/90">N 52.12° E 4.89°</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-cyan-500/20 bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-glow-cyan-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
            </span>
            Streaming
          </div>
        </div>

        {/* Floating KPI deck */}
        <div className="mt-4 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-3">
          {mapKpis.map((m, i) => (
            <KpiGlassCard key={m.id} metric={m} index={i} />
          ))}
        </div>

        {/* Simulated map markers / overlay chips */}
        <div className="pointer-events-none absolute bottom-[28%] left-[18%] md:left-[22%]">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-cyan-400/40 bg-background/70 px-3 py-1.5 text-xs text-foreground shadow-glow-cyan backdrop-blur-md"
          >
            <MapPin className="size-3.5 text-cyan-400" />
            Site A — 412 devices
          </motion.div>
        </div>
        <div className="pointer-events-none absolute bottom-[38%] right-[24%] md:right-[28%]">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.55 }}
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-400/35 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-100 shadow-[0_0_20px_-4px_rgba(251,191,36,0.35)] backdrop-blur-md"
          >
            <MapPin className="size-3.5 text-amber-300" />
            2 alarms
          </motion.div>
        </div>

        {/* Bottom alarm overlay rail */}
        <div className="mt-auto w-full max-w-2xl pt-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active site alarms</p>
          <AlarmStrip alarms={MOCK_ALARMS} />
        </div>
      </div>
    </div>
  );
}
