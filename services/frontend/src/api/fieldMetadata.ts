import { apiFetch } from "@/api/client";

/** GET /scrubber/data-objects/{id}/field-metadata — Phase E catalog for authoring. */
export type PayloadFieldEntry = {
  path: string;
  type: string;
  sample: unknown;
  section?: string | null;
  source?: string;
};

export async function getDataObjectFieldMetadata(dataObjectId: string) {
  return apiFetch<{ items: PayloadFieldEntry[] }>(
    `/scrubber/data-objects/${encodeURIComponent(dataObjectId)}/field-metadata`,
  );
}

export async function getResultObjectFieldMetadata(resultObjectId: string) {
  return apiFetch<{ items: PayloadFieldEntry[] }>(
    `/result-objects/${encodeURIComponent(resultObjectId)}/field-metadata`,
  );
}
