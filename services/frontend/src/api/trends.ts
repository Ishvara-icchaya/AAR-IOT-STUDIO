import { apiFetch } from "@/api/client";
import type { TrendsWindowResponseDTO } from "@/types/trends";

export async function getTrendsWindow(params: {
  siteId: string;
  scope: string;
  entityId: string;
  metrics: string[];
  window: "1h" | "24h";
  bucket?: "5m";
  asOf?: string;
}) {
  const qs = new URLSearchParams();
  qs.set("site_id", params.siteId);
  qs.set("scope", params.scope);
  qs.set("entityId", params.entityId);
  qs.set("metrics", params.metrics.join(","));
  qs.set("window", params.window);
  qs.set("bucket", params.bucket ?? "5m");
  if (params.asOf) qs.set("as_of", params.asOf);
  return apiFetch<TrendsWindowResponseDTO>(`/trends/window?${qs.toString()}`, { cache: "no-store" });
}
