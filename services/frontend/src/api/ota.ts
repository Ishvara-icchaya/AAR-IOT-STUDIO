import { apiFetch } from "./client";

export type OtaCampaignRead = {
  id: string;
  customer_id: string;
  site_id: string | null;
  name: string;
  artifact_id: string | null;
  target_firmware_version: string | null;
  target_device_version_id: string | null;
  status: string;
  rollout_strategy: string | null;
  approval_status: string;
  created_by: string | null;
  approved_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type OtaCampaignTargetRead = {
  id: string;
  campaign_id: string;
  device_id: string;
  resolved_device_id: string | null;
  previous_device_version_id: string | null;
  target_device_version_id: string | null;
  current_firmware_version: string | null;
  target_firmware_version: string | null;
  status: string;
  progress_pct: number;
  failure_code: string | null;
  failure_message: string | null;
  last_status_at: string | null;
  completed_at: string | null;
  external_command_id: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  progress_phase: string | null;
  reported_ota_external_ref: string | null;
};

export type OtaCampaignDetailRead = OtaCampaignRead & {
  targets: OtaCampaignTargetRead[];
  /** Present for users with ota.launch when the campaign has a simulator poll token (after launch). */
  simulator_poll_url?: string | null;
  /** Same token as poll; POST terminal status without JWT. */
  simulator_status_url?: string | null;
};

export type OtaEventRead = {
  id: string;
  campaign_id: string;
  target_id: string | null;
  event_type: string;
  payload_json: Record<string, unknown> | null;
  created_at: string;
};

export type FirmwareArtifactRead = {
  id: string;
  customer_id: string;
  site_id: string | null;
  artifact_url: string;
  sha256: string;
  signature: string | null;
  signature_algorithm: string | null;
  size_bytes: number | null;
  release_notes: string | null;
  created_at: string;
};

export async function listOtaArtifacts(siteId: string) {
  return apiFetch<{ items: FirmwareArtifactRead[] }>(
    `/ota/artifacts?site_id=${encodeURIComponent(siteId)}`,
  );
}

export async function createOtaArtifact(body: {
  site_id: string;
  artifact_url: string;
  sha256: string;
  signature?: string | null;
  signature_algorithm?: string | null;
  size_bytes?: number | null;
  release_notes?: string | null;
}) {
  return apiFetch<FirmwareArtifactRead>("/ota/artifacts", { method: "POST", json: body });
}

export async function listOtaCampaigns(params?: { site_id?: string; status?: string }) {
  const sp = new URLSearchParams();
  if (params?.site_id) sp.set("site_id", params.site_id);
  if (params?.status?.trim()) sp.set("status", params.status.trim());
  const qs = sp.toString();
  return apiFetch<{ items: OtaCampaignRead[] }>(qs ? `/ota/campaigns?${qs}` : "/ota/campaigns");
}

export async function getOtaCampaign(campaignId: string) {
  return apiFetch<OtaCampaignDetailRead>(`/ota/campaigns/${encodeURIComponent(campaignId)}`);
}

export async function createOtaCampaign(body: {
  name: string;
  site_id: string;
  artifact_id?: string | null;
  target_firmware_version?: string | null;
  target_device_version_id?: string | null;
  rollout_strategy?: string | null;
}) {
  return apiFetch<OtaCampaignRead>("/ota/campaigns", { method: "POST", json: body });
}

export async function patchOtaCampaign(
  campaignId: string,
  body: {
    name?: string;
    artifact_id?: string | null;
    target_firmware_version?: string | null;
    rollout_strategy?: string | null;
    target_device_version_id?: string | null;
  },
) {
  return apiFetch<OtaCampaignRead>(`/ota/campaigns/${encodeURIComponent(campaignId)}`, {
    method: "PATCH",
    json: body,
  });
}

export async function addOtaCampaignTargets(campaignId: string, device_ids: string[]) {
  return apiFetch<{ added: OtaCampaignTargetRead[] }>(
    `/ota/campaigns/${encodeURIComponent(campaignId)}/targets`,
    { method: "POST", json: { device_ids } },
  );
}

export async function removeOtaCampaignTarget(campaignId: string, targetId: string) {
  await apiFetch(`/ota/campaigns/${encodeURIComponent(campaignId)}/targets/${encodeURIComponent(targetId)}`, {
    method: "DELETE",
  });
}

export async function submitOtaCampaign(campaignId: string) {
  return apiFetch<OtaCampaignRead>(`/ota/campaigns/${encodeURIComponent(campaignId)}/submit`, { method: "POST" });
}

export async function approveOtaCampaign(campaignId: string) {
  return apiFetch<OtaCampaignRead>(`/ota/campaigns/${encodeURIComponent(campaignId)}/approve`, { method: "POST" });
}

export async function launchOtaCampaign(campaignId: string) {
  return apiFetch<OtaCampaignRead>(`/ota/campaigns/${encodeURIComponent(campaignId)}/launch`, { method: "POST" });
}

export async function pauseOtaCampaign(campaignId: string) {
  return apiFetch<OtaCampaignRead>(`/ota/campaigns/${encodeURIComponent(campaignId)}/pause`, { method: "POST" });
}

export async function resumeOtaCampaign(campaignId: string) {
  return apiFetch<OtaCampaignRead>(`/ota/campaigns/${encodeURIComponent(campaignId)}/resume`, { method: "POST" });
}

export async function cancelOtaCampaign(campaignId: string) {
  return apiFetch<OtaCampaignRead>(`/ota/campaigns/${encodeURIComponent(campaignId)}/cancel`, { method: "POST" });
}

export async function listOtaCampaignEvents(campaignId: string, limit = 200) {
  return apiFetch<{ items: OtaEventRead[] }>(
    `/ota/campaigns/${encodeURIComponent(campaignId)}/events?limit=${encodeURIComponent(String(limit))}`,
  );
}

export async function reportOtaTargetStatus(
  body: {
    target_id: string;
    status: "success" | "failed" | "rolled_back" | "timeout" | "cancelled";
    command_id?: string | null;
    message?: string | null;
    ota_external_ref?: string | null;
  },
  opts?: {
    idempotencyKey: string;
    terminalOverride?: boolean;
  },
) {
  const idem = opts?.idempotencyKey?.trim();
  if (!idem) {
    throw new Error("reportOtaTargetStatus requires opts.idempotencyKey");
  }
  const headers: Record<string, string> = { "Idempotency-Key": idem };
  if (opts?.terminalOverride) headers["X-Ota-Terminal-Override"] = "true";
  return apiFetch<{
    target_id: string;
    campaign_id: string;
    device_id: string;
    status: string;
  }>("/ota/status", { method: "POST", json: body, headers });
}
