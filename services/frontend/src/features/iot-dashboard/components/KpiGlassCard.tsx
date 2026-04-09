import { motion } from "framer-motion";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { KpiMetric } from "../mockData";

export function KpiGlassCard({ metric, index = 0 }: { metric: KpiMetric; index?: number }) {
  const up = metric.deltaPct != null && metric.deltaPct > 0;
  const down = metric.deltaPct != null && metric.deltaPct < 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card
        className={cn(
          "overflow-hidden border-cyan-500/25 bg-gradient-to-br from-card/80 to-muted/30 shadow-glow-cyan-sm",
          metric.status === "warn" && "border-amber-500/35 shadow-[0_0_20px_-4px_rgba(251,191,36,0.25)]",
          metric.status === "crit" && "border-red-500/40 shadow-[0_0_20px_-4px_rgba(248,113,113,0.2)]",
        )}
      >
        <CardContent className="p-4 pt-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{metric.label}</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{metric.value}</span>
            {metric.deltaPct != null ? (
              <span
                className={cn(
                  "flex items-center gap-0.5 text-xs font-medium",
                  up ? "text-emerald-400" : down ? "text-red-300" : "text-muted-foreground",
                )}
              >
                {up ? <TrendingUp className="size-3.5" /> : down ? <TrendingDown className="size-3.5" /> : null}
                {metric.deltaPct > 0 ? "+" : ""}
                {metric.deltaPct}%
              </span>
            ) : null}
          </div>
          {metric.sub ? <p className="mt-1 text-xs text-muted-foreground">{metric.sub}</p> : null}
        </CardContent>
      </Card>
    </motion.div>
  );
}
