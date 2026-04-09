import { apiFetch } from "@/api/client";
import type { ResultObjectV1 } from "@/types/resultObjectContract";

/** GET /api/v1/result-objects/{id} — frozen v1 contract */
export async function getResultObject(id: string) {
  return apiFetch<ResultObjectV1>(`/result-objects/${id}`);
}
