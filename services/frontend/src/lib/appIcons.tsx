import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ChartColumn,
  LayoutDashboard,
  RefreshCw,
  Settings2,
  Smartphone,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react";

export const ICON_SIZES = {
  table: 16,
  card: 20,
  header: 24,
} as const;

export const ICON_STROKE_WIDTH = 1.9;

export type AppIconName =
  | "device"
  | "alert"
  | "online"
  | "offline"
  | "degraded"
  | "settings"
  | "refresh"
  | "dashboard"
  | "chart";

export const APP_ICON_MAP: Record<AppIconName, LucideIcon> = {
  device: Smartphone,
  alert: TriangleAlert,
  online: Wifi,
  offline: WifiOff,
  degraded: Activity,
  settings: Settings2,
  refresh: RefreshCw,
  dashboard: LayoutDashboard,
  chart: ChartColumn,
};

type IconSizePreset = keyof typeof ICON_SIZES;

export function AppIcon({
  name,
  size = "table",
  strokeWidth = ICON_STROKE_WIDTH,
  ...rest
}: {
  name: AppIconName;
  size?: IconSizePreset | number;
  strokeWidth?: number;
} & Omit<ComponentProps<LucideIcon>, "size" | "strokeWidth">) {
  const Icon = APP_ICON_MAP[name];
  const px = typeof size === "number" ? size : ICON_SIZES[size];
  return <Icon size={px} strokeWidth={strokeWidth} {...rest} />;
}
