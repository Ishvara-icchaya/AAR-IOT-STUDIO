import type { LucideIcon } from "lucide-react";
import { Building2, FileCode2, FileStack, LayoutDashboard, Share2, Smartphone, Sparkles, Workflow } from "lucide-react";
import { ICON_SIZES, ICON_STROKE_WIDTH } from "@/lib/appIcons";

/** Icons for primary shell navigation (tooltips use full labels from navigation config). */
export const MAIN_NAV_FLAT_ICONS: Record<string, LucideIcon> = {
  devices: Smartphone,
  "raw-sample": FileStack,
  "scrubber-v2": FileCode2,
  workflow: Workflow,
  "enterprise-ai": Sparkles,
};

export const MAIN_NAV_GROUP_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  enterprise: Building2,
  published: Share2,
};

export function MainNavFlatIcon({ navId }: { navId: string }) {
  const Icon = MAIN_NAV_FLAT_ICONS[navId] ?? Smartphone;
  return <Icon size={ICON_SIZES.header} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />;
}

export function MainNavGroupIcon({ groupId }: { groupId: string }) {
  const Icon = MAIN_NAV_GROUP_ICONS[groupId] ?? Sparkles;
  return <Icon size={ICON_SIZES.header} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />;
}
