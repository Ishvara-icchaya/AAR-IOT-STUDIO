import { motion } from "framer-motion";
import { AlertTriangle, Bell, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SiteAlarm } from "../mockData";

const icon = {
  critical: AlertTriangle,
  warning: Bell,
  info: Info,
};

export function AlarmStrip({ alarms }: { alarms: SiteAlarm[] }) {
  return (
    <div className="flex flex-col gap-2">
      {alarms.map((a, i) => {
        const Icon = icon[a.severity];
        return (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.05 }}
            className={cn(
              "flex items-start gap-3 rounded-lg border border-cyan-500/15 bg-muted/30 px-3 py-2.5 backdrop-blur-md",
              a.severity === "critical" && "border-red-500/35 bg-red-950/20",
              a.severity === "warning" && "border-amber-500/30 bg-amber-950/15",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                a.severity === "critical" && "text-red-400",
                a.severity === "warning" && "text-amber-300",
                a.severity === "info" && "text-cyan-400",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">{a.title}</p>
                <Badge
                  variant={a.severity === "critical" ? "destructive" : a.severity === "warning" ? "warning" : "secondary"}
                  className="text-[10px]"
                >
                  {a.severity}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {a.site} · <span className="font-mono text-cyan-200/80">{a.asset}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/80">{a.at}</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
