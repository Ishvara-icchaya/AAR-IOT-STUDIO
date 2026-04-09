import { apiFetch } from "@/api/client";

/** Mirrors `DataObjectRead` from the scrubber API. */
export type ScrubberDataObjectDTO = {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  kpi_json: Record<string, unknown>;
  health_status: string | null;
  health_code: string | null;
  health_message: string | null;
  lifecycle_status: string;
  updated_at: string;
};

export async function getScrubberDataObject(id: string) {
  return apiFetch<ScrubberDataObjectDTO>(`/scrubber/data-objects/${encodeURIComponent(id)}`);
}
