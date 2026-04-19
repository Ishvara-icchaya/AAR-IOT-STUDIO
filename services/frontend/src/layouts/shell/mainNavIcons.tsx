import type { LucideIcon } from "lucide-react";
import { BrushCleaning, Building2, LayoutDashboard, Share2, Smartphone, Sparkles, Workflow } from "lucide-react";

/** Icons for primary shell navigation (tooltips use full labels from navigation config). */
export const MAIN_NAV_FLAT_ICONS: Record<string, LucideIcon> = {
  devices: Smartphone,
  "enterprise-ai": Sparkles,
};

export const MAIN_NAV_GROUP_ICONS: Record<string, LucideIcon> = {
  scrubber: BrushCleaning,
  workflow: Workflow,
  dashboard: LayoutDashboard,
  enterprise: Building2,
  published: Share2,
};

export function MainNavFlatIcon({ navId }: { navId: string }) {
  const Icon = MAIN_NAV_FLAT_ICONS[navId] ?? Smartphone;
  return <Icon size={26} strokeWidth={2} aria-hidden />;
}

export function MainNavGroupIcon({ groupId }: { groupId: string }) {
  const Icon = MAIN_NAV_GROUP_ICONS[groupId] ?? Sparkles;
  return <Icon size={26} strokeWidth={2} aria-hidden />;
}
