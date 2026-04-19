import { apiFetch } from "@/api/client";

/** Mirrors `DataObjectRead` from the scrubber API (metadata + mirrored latest). */
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
  latest_detail_id?: string | null;
  latest_seen_at?: string | null;
};

export async function getScrubberDataObject(id: string) {
  return apiFetch<ScrubberDataObjectDTO>(`/scrubber/data-objects/${encodeURIComponent(id)}`);
}

export type HealthThresholdReferenceDTO = {
  id: string;
  customer_id: string;
  site_id: string | null;
  device_id: string | null;
  reference_name: string;
  body_json: Record<string, unknown>;
};

export async function listHealthThresholdReferences(params?: { site_id?: string; device_id?: string }) {
  const qs = new URLSearchParams();
  if (params?.site_id) qs.set("site_id", params.site_id);
  if (params?.device_id) qs.set("device_id", params.device_id);
  const s = qs.toString();
  return apiFetch<{ items: HealthThresholdReferenceDTO[] }>(
    `/scrubber/health-threshold-references${s ? `?${s}` : ""}`,
  );
}

/** One row from `data_object_details` (observed history). */
export type DataObjectDetailDTO = {
  id: string;
  data_object_id: string;
  raw_data_object_id: string | null;
  customer_id: string;
  site_id: string;
  device_id: string;
  observed_at: string;
  payload_json: Record<string, unknown>;
  kpi_json: Record<string, unknown>;
  health_status: string | null;
  health_code: string | null;
  health_message: string | null;
  grouping_json: Record<string, unknown>;
  trace_id: string | null;
  created_at: string;
};

export type DataObjectDetailListDTO = {
  items: DataObjectDetailDTO[];
  total: number;
  page: number;
  page_size: number;
};

export async function listDataObjectDetails(
  dataObjectId: string,
  params?: { page?: number; page_size?: number },
) {
  const qs = new URLSearchParams();
  if (params?.page != null) qs.set("page", String(params.page));
  if (params?.page_size != null) qs.set("page_size", String(params.page_size));
  const s = qs.toString();
  return apiFetch<DataObjectDetailListDTO>(
    `/scrubber/data-objects/${encodeURIComponent(dataObjectId)}/details${s ? `?${s}` : ""}`,
  );
}

export async function getDataObjectDetail(dataObjectId: string, detailId: string) {
  return apiFetch<DataObjectDetailDTO>(
    `/scrubber/data-objects/${encodeURIComponent(dataObjectId)}/details/${encodeURIComponent(detailId)}`,
  );
}
