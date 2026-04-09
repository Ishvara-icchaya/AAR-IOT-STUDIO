import { apiFetch } from "@/api/client";

export type CustomerPatchResponse = { id: string; name: string };

export function patchCustomerName(name: string) {
  return apiFetch<CustomerPatchResponse>("/administration/customer", {
    method: "PATCH",
    json: { name },
  });
}
