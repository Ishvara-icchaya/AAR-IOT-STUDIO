import { Activity, Bell, Bot, ChevronDown, DatabaseZap, LayoutDashboard, RefreshCw, Server, Settings, UserCircle, Workflow } from "lucide-react";

export const NAV_ICONS = {
  devices: Server,
  pipelines: DatabaseZap,
  registerEndpoint: Bot,
  workflows: Workflow,
  dashboards: LayoutDashboard,
  monitoring: Activity,
  ai: Bot,
  settings: Settings,
  alerts: Bell,
  refresh: RefreshCw,
  user: UserCircle,
  chevron: ChevronDown,
} as const;
