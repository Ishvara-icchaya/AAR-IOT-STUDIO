import { apiFetch } from "@/api/client";

export type CustomerPatchResponse = { id: string; name: string };

export function patchCustomerName(name: string) {
  return apiFetch<CustomerPatchResponse>("/administration/customer", {
    method: "PATCH",
    json: { name },
  });
}

export type TenantOperationalDataClearResponse = { deleted_counts: Record<string, number> };

/** Removes devices, raw/data objects, workflows (incl. result objects), dashboards, etc. Sites and users are kept. Admin only. */
export function clearOperationalData(password: string, confirmation_phrase: string) {
  return apiFetch<TenantOperationalDataClearResponse>("/administration/clear-operational-data", {
    method: "POST",
    json: { password, confirmation_phrase },
  });
}
