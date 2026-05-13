import { AarStatusPill, type AarStatusVariant } from "@/components/system/AarStatusPill";
import { formatStatusDisplayLabel } from "@/lib/statusDisplay";

export type OpsVariant = "online" | "degraded" | "offline" | "error" | "muted" | "disabled" | "waiting";

type Props = {
  status: string;
  variant: OpsVariant;
};

const toAar: Record<OpsVariant, AarStatusVariant> = {
  online: "online",
  /** Neutral / informational — white border tier (same as muted in CSS). */
  degraded: "muted",
  offline: "offline",
  /** Hard-negative — red border tier */
  error: "invalid",
  muted: "muted",
  disabled: "disabled",
  waiting: "waiting",
};

export function OpsStatusPill({ status, variant }: Props) {
  const trimmed = (status ?? "").trim();
  const label = !trimmed || trimmed === "—" ? status || "—" : formatStatusDisplayLabel(trimmed);
  return <AarStatusPill status={label} variant={toAar[variant]} />;
}
