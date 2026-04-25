import { AarStatusPill, type AarStatusVariant } from "@/components/system/AarStatusPill";

type OpsVariant = "online" | "degraded" | "offline" | "error" | "muted";

type Props = {
  status: string;
  variant: OpsVariant;
};

const toAar: Record<OpsVariant, AarStatusVariant> = {
  online: "online",
  degraded: "degraded",
  offline: "offline",
  error: "error",
  muted: "muted",
};

export function OpsStatusPill({ status, variant }: Props) {
  return <AarStatusPill status={status} variant={toAar[variant]} />;
}
