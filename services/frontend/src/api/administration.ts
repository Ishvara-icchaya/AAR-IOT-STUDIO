import { apiFetch } from "@/api/client";

export type CustomerPatchResponse = { id: string; name: string };

export function patchCustomerName(name: string) {
  return apiFetch<CustomerPatchResponse>("/administration/customer", {
    method: "PATCH",
    json: { name },
  });
}

export type TenantOperationalDataClearResponse = { deleted_counts: Record<string, number> };

export type TenantOperationalDataClearJobAccepted = {
  job_id: string;
  status: string;
  poll_path: string;
};

export type OperationalClearJobStatus = {
  job_id: string;
  customer_id: string;
  status: string;
  phase: string;
  deleted_counts: Record<string, number>;
  error: string | null;
  created_at: number;
  updated_at: number;
};

/** Poll async operational clear (admin only). */
export function getOperationalClearJob(jobId: string) {
  return apiFetch<OperationalClearJobStatus>(
    `/administration/clear-operational-data/jobs/${encodeURIComponent(jobId)}`,
  );
}

/**
 * Removes devices, raw/data objects, workflows (incl. result objects), dashboards, v2 endpoint
 * read models, etc. Sites and users are kept. Admin only.
 *
 * With `asyncExecution: true`, returns 202 payload with `job_id` — poll with `getOperationalClearJob`.
 */
export function clearOperationalData(
  password: string,
  confirmation_phrase: string,
  opts?: { asyncExecution?: boolean },
) {
  const json: Record<string, unknown> = { password, confirmation_phrase };
  if (opts?.asyncExecution) json.async_execution = true;
  return apiFetch<TenantOperationalDataClearResponse | TenantOperationalDataClearJobAccepted>(
    "/administration/clear-operational-data",
    {
      method: "POST",
      json,
    },
  );
}
