import { motion } from "framer-motion";
import { ExternalLink, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { AlarmStrip } from "../components/AlarmStrip";
import { MOCK_ALARMS, MOCK_KPIS } from "../mockData";

export function IotRightPanel() {
  const critical = MOCK_ALARMS.filter((a) => a.severity === "critical").length;

  return (
    <motion.aside
      initial={{ x: 16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex min-h-0 w-[300px] shrink-0 flex-col border-l border-cyan-500/15 bg-muted/15 backdrop-blur-xl"
    >
      <div className="border-b border-cyan-500/15 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Context</p>
        <p className="mt-0.5 text-sm font-medium text-foreground">Live operations</p>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          <Card className="border-cyan-500/20 bg-card/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                Fleet health
                <Badge variant="outline" className="font-normal">
                  SLA 99.94%
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Active devices</span>
                <span className="font-mono text-foreground">{MOCK_KPIS[0]?.value}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Ingest rate</span>
                <span className="font-mono text-foreground">{MOCK_KPIS[1]?.value}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Open critical</span>
                <span className={critical > 0 ? "font-mono text-red-300" : "font-mono text-emerald-300"}>{critical}</span>
              </div>
              <Separator className="bg-cyan-500/15" />
              <div className="flex items-start gap-2 rounded-md border border-cyan-500/20 bg-primary/10 p-2">
                <Zap className="mt-0.5 size-4 shrink-0 text-cyan-400" />
                <p className="leading-snug text-muted-foreground">
                  Cyan accents and glass panels match enterprise NOC dashboards — swap mock KPIs for live API data.
                </p>
              </div>
            </CardContent>
          </Card>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Alarm queue</p>
            <AlarmStrip alarms={MOCK_ALARMS} />
          </div>

          <Card className="border-cyan-500/20 bg-card/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Quick links</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button variant="secondary" size="sm" className="justify-between" asChild>
                <Link to="/alerts">
                  Unified alerts
                  <ExternalLink className="size-3.5 opacity-70" />
                </Link>
              </Button>
              <Button variant="secondary" size="sm" className="justify-between" asChild>
                <Link to="/devices/manage">
                  Device registry
                  <ExternalLink className="size-3.5 opacity-70" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </motion.aside>
  );
}
