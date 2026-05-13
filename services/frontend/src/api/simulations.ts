import { apiFetch } from "@/api/client";

export type SimulationJobRead = {
  id: string;
  customer_id: string;
  site_id: string;
  device_id: string;
  created_by: string | null;
  baseline_device_version_id: string | null;
  candidate_device_version_id: string | null;
  window_start: string;
  window_end: string;
  sample_size: number;
  records_tested: number;
  records_passed: number;
  records_failed: number;
  status: string;
  error_message: string | null;
  result_json: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
};

export type ReplaySimulationCreate = {
  device_id: string;
  candidate_device_version_id?: string | null;
  baseline_device_version_id?: string | null;
  scope_hours?: number;
  sample_size?: number;
};

export async function runReplaySimulation(body: ReplaySimulationCreate) {
  return apiFetch<SimulationJobRead>("/simulations/replay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getSimulationJob(jobId: string) {
  return apiFetch<SimulationJobRead>(`/simulations/${encodeURIComponent(jobId)}`);
}
