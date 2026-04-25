export type AarStatusVariant =
  | "online"
  | "active"
  | "draft"
  | "published"
  | "frozen"
  | "disabled"
  | "warning"
  | "degraded"
  | "offline"
  | "error"
  | "valid"
  | "invalid"
  | "waiting"
  | "muted";

type Props = {
  status: string;
  variant: AarStatusVariant;
};

export function AarStatusPill({ status, variant }: Props) {
  return <span className={`aar-status-pill aar-status-pill--${variant}`}>{status}</span>;
}
