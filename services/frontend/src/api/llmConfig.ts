import { apiFetch } from "./client";
import type { LlmConfigDTO, LlmConfigResetResponse, LlmConfigTestResponse, LlmConfigUpdateDTO } from "@/types/llmConfig";

export async function fetchLlmConfig(): Promise<LlmConfigDTO | null> {
  return apiFetch<LlmConfigDTO>("/admin/llm-config");
}

export async function putLlmConfig(body: LlmConfigUpdateDTO): Promise<LlmConfigDTO | null> {
  return apiFetch<LlmConfigDTO>("/admin/llm-config", {
    method: "PUT",
    json: body,
  });
}

export async function testLlmConfig(): Promise<LlmConfigTestResponse | null> {
  return apiFetch<LlmConfigTestResponse>("/admin/llm-config/test", { method: "POST" });
}

export async function resetLlmConfig(): Promise<LlmConfigResetResponse | null> {
  return apiFetch<LlmConfigResetResponse>("/admin/llm-config/reset", { method: "POST" });
}
