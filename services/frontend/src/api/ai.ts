import { apiFetch } from "@/api/client";
import type {
  AIChatRequest,
  AIChatResponse,
  AIDatasetMeta,
  AIHealth,
  AIRecentQuery,
  AISavedQuery,
  AISuggestionItem,
} from "@/types/ai";

export type { AIChatRequest, AIChatResponse, AIDatasetMeta, AIHealth, AIRecentQuery, AISavedQuery, AISuggestionItem };

export async function postAiChat(body: AIChatRequest) {
  return apiFetch<AIChatResponse>("/ai/chat", { method: "POST", json: body });
}

export async function getAiDatasets() {
  return apiFetch<{ items: AIDatasetMeta[] }>("/ai/datasets");
}

export async function getAiHealth() {
  return apiFetch<AIHealth>("/ai/health");
}

export async function getAiSuggestions() {
  return apiFetch<{ items: AISuggestionItem[] }>("/ai/suggestions");
}

export async function getAiRecentQueries(limit = 25) {
  return apiFetch<AIRecentQuery[]>(`/ai/recent-queries?limit=${limit}`);
}

export async function getAiSavedQueries() {
  return apiFetch<AISavedQuery[]>("/ai/saved-queries");
}

export async function postAiSaveQuery(body: {
  name: string;
  question: string;
  default_site_scope_json?: string[];
  default_time_range?: string;
}) {
  return apiFetch<AISavedQuery>("/ai/save-query", { method: "POST", json: body });
}

export async function deleteAiSavedQuery(id: string) {
  return apiFetch<null>(`/ai/saved-queries/${encodeURIComponent(id)}`, { method: "DELETE" });
}
