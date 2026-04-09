import { motion } from "framer-motion";
import {
  Activity,
  Cpu,
  Gauge,
  LayoutDashboard,
  Radio,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { icon: LayoutDashboard, label: "Overview", active: true },
  { icon: Radio, label: "Devices" },
  { icon: Activity, label: "Telemetry" },
  { icon: Gauge, label: "Alarms" },
  { icon: Cpu, label: "Edge compute" },
  { icon: ShieldCheck, label: "Security" },
  { icon: Settings2, label: "Settings" },
];

export function IotSidebar() {
  return (
    <motion.aside
      initial={{ x: -12, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex w-[220px] shrink-0 flex-col border-r border-cyan-500/15 bg-muted/20 backdrop-blur-xl"
    >
      <div className="flex h-14 items-center gap-2 border-b border-cyan-500/15 px-4">
        <div className="flex size-9 items-center justify-center rounded-lg border border-cyan-500/35 bg-primary/20 shadow-glow-cyan-sm">
          <Cpu className="size-5 text-cyan-300" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">AAR</p>
          <p className="text-sm font-semibold text-foreground">IoT Control</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {items.map((item, i) => (
          <motion.button
            key={item.label}
            type="button"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 * i }}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
              item.active
                ? "border border-cyan-500/30 bg-primary/20 text-primary-foreground shadow-glow-cyan-sm"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <item.icon className="size-4 shrink-0 opacity-90" />
            {item.label}
          </motion.button>
        ))}
      </nav>
      <div className="border-t border-cyan-500/15 p-3">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Mock navigation · wire to your routes when integrating with the platform shell.
        </p>
      </div>
    </motion.aside>
  );
}
