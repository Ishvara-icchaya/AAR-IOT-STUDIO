import { apiFetch } from "@/api/client";
import type { ResultObjectV1 } from "@/types/resultObjectContract";
import type { WorkflowReadDTO, WorkflowListItemDTO } from "@/types/workflow";

export type WorkflowCreateBody = {
  site_id: string;
  name: string;
  description?: string | null;
  nodes: Array<{
    id: string;
    node_type: string;
    node_name: string;
    config_json: Record<string, unknown>;
    position_x?: number;
    position_y?: number;
  }>;
  edges: Array<{
    id: string;
    source_node_id: string;
    target_node_id: string;
  }>;
};

export type WorkflowUpdateBody = {
  name?: string;
  description?: string | null;
  site_id?: string;
  nodes?: WorkflowCreateBody["nodes"];
  edges?: WorkflowCreateBody["edges"];
};

export async function listWorkflows(params?: { site_id?: string; q?: string }) {
  const qs = new URLSearchParams();
  if (params?.site_id) qs.set("site_id", params.site_id);
  if (params?.q) qs.set("q", params.q);
  const s = qs.toString();
  return apiFetch<{ items: WorkflowListItemDTO[] }>(`/workflows${s ? `?${s}` : ""}`);
}

export async function getWorkflow(id: string) {
  return apiFetch<WorkflowReadDTO>(`/workflows/${id}`);
}

export async function createWorkflow(body: WorkflowCreateBody) {
  return apiFetch<WorkflowReadDTO>(`/workflows`, { method: "POST", json: body });
}

export async function updateWorkflow(id: string, body: WorkflowUpdateBody) {
  return apiFetch<WorkflowReadDTO>(`/workflows/${id}`, { method: "PUT", json: body });
}

export async function deleteWorkflow(id: string) {
  return apiFetch(`/workflows/${id}`, { method: "DELETE" });
}

export async function duplicateWorkflow(id: string) {
  return apiFetch<WorkflowReadDTO>(`/workflows/${id}/duplicate`, { method: "POST" });
}

export async function validateWorkflow(id: string) {
  return apiFetch<{ valid: boolean; errors: string[] }>(`/workflows/${id}/validate`, { method: "POST" });
}

export async function testWorkflow(
  id: string,
  body: { sample_payload?: Record<string, unknown> | null; data_object_id?: string | null },
) {
  return apiFetch<{
    workflow_id: string;
    status: string;
    node_outputs: Record<string, Record<string, unknown>>;
    result_objects: Array<{ result_object_name: string; payload: Record<string, unknown> }>;
    error: string | null;
  }>(`/workflows/${id}/test`, { method: "POST", json: body });
}

export async function publishWorkflow(id: string) {
  return apiFetch<WorkflowReadDTO>(`/workflows/${id}/publish`, { method: "POST" });
}

export async function stopPublishWorkflow(id: string) {
  return apiFetch<WorkflowReadDTO>(`/workflows/${id}/stop-publish`, { method: "POST" });
}

export async function listPublishedDataSources(siteId: string) {
  return apiFetch<{ items: Array<{ id: string; name: string; updated_at: string }> }>(
    `/workflows/data-sources?site_id=${encodeURIComponent(siteId)}`,
  );
}

export async function listExecutions(id: string, limit = 50) {
  return apiFetch<{ items: Array<Record<string, unknown>> }>(
    `/workflows/${id}/executions?limit=${limit}`,
  );
}

export async function listResultObjects(id: string, limit = 50) {
  return apiFetch<{ items: ResultObjectV1[] }>(`/workflows/${id}/result-objects?limit=${limit}`);
}
