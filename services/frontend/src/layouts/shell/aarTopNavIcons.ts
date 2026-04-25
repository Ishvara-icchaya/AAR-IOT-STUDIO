import {
  Activity,
  Bell,
  Bot,
  ChevronDown,
  DatabaseZap,
  LayoutDashboard,
  RefreshCw,
  Server,
  Settings,
  UserCircle,
  Workflow,
} from "lucide-react";

export const NAV_ICONS = {
  devices: Server,
  pipelines: DatabaseZap,
  workflows: Workflow,
  dashboards: LayoutDashboard,
  ai: Bot,
  monitoring: Activity,
  settings: Settings,
  alerts: Bell,
  refresh: RefreshCw,
  user: UserCircle,
  chevron: ChevronDown,
} as const;
