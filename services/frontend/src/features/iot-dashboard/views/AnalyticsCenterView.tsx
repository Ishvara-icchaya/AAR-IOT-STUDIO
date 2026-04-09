import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiGlassCard } from "../components/KpiGlassCard";
import { MOCK_EVENTS, MOCK_KPIS, MOCK_POWER_SERIES, MOCK_TEMP_SERIES } from "../mockData";

const chartTooltip = {
  contentStyle: {
    background: "hsl(222 40% 8% / 0.95)",
    border: "1px solid hsl(187 100% 45% / 0.35)",
    borderRadius: "8px",
    fontSize: "12px",
    color: "hsl(210 40% 98%)",
  },
  labelStyle: { color: "hsl(215 20% 65%)" },
};

export function AnalyticsCenterView() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-auto pr-1">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {MOCK_KPIS.map((m, i) => (
          <KpiGlassCard key={m.id} metric={m} index={i} />
        ))}
      </motion.div>

      <div className="grid min-h-[240px] flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="flex h-full min-h-[220px] flex-col border-cyan-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Power draw (kW)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 min-h-[180px] flex-col pt-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={MOCK_POWER_SERIES} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pwr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(187 100% 45%)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="hsl(187 100% 45%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(188 35% 22% / 0.5)" vertical={false} />
                  <XAxis dataKey="t" tick={{ fill: "hsl(215 20% 55%)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(215 20% 55%)", fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip {...chartTooltip} />
                  <Area type="monotone" dataKey="v" stroke="hsl(187 100% 50%)" strokeWidth={2} fill="url(#pwr)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
          <Card className="flex h-full min-h-[220px] flex-col border-cyan-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Avg process temp (°C)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 min-h-[180px] flex-col pt-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={MOCK_TEMP_SERIES} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(188 35% 22% / 0.5)" vertical={false} />
                  <XAxis dataKey="t" tick={{ fill: "hsl(215 20% 55%)", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(215 20% 55%)", fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip {...chartTooltip} />
                  <Bar dataKey="v" fill="hsl(187 85% 42% / 0.85)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
        <Card className="border-cyan-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Recent events</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="w-[100px]">Severity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MOCK_EVENTS.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell className="font-mono text-muted-foreground">{ev.ts}</TableCell>
                    <TableCell>{ev.type}</TableCell>
                    <TableCell className="font-mono text-cyan-200/80">{ev.device}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{ev.message}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          ev.severity === "error" ? "destructive" : ev.severity === "warning" ? "warning" : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {ev.severity}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
