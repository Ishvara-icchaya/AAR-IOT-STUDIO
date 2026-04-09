/** Enterprise AI API types (/api/v1/ai). */

export type AIChatRequest = {
  message: string;
  site_ids?: string[] | null;
  time_range?: string | null;
  use_llm?: boolean;
  debug_raw?: boolean;
};

export type AIChatResponse = {
  answer: string;
  llm_used: boolean;
  degraded: boolean;
  mode?: "structured_only" | "structured_plus_llm";
  evidence: {
    datasets: string[];
    rows_returned: number;
    time_range: string | null;
    time_window_utc?: { start: string; end: string } | null;
    filters_applied: Record<string, unknown>;
    warnings: string[];
    source_pages?: string[];
    rows_clamped?: boolean;
    span_clamped?: boolean;
  };
  plan: {
    dataset: string | null;
    aggregation: string | null;
    limit: number | null;
    filters: Record<string, unknown>;
    intent?: string | null;
    include_payload?: boolean;
    time_range?: { preset?: string } | null;
  };
  results: Record<string, unknown>;
  warnings?: string[];
};

export type AIDatasetMeta = {
  name: string;
  description: string;
  default_limit: number;
  max_limit: number;
  allowed_filter_keys: string[];
  allowed_aggregations: string[];
};

export type AISuggestionItem = {
  id: string;
  prompt: string;
  intent_hint?: string;
};

export type AIRecentQuery = {
  id: string;
  question: string;
  intent: string;
  llm_used: boolean;
  degraded: boolean;
  response_mode?: string | null;
  created_at: string | null;
};

export type AISavedQuery = {
  id: string;
  name: string;
  question: string;
  default_site_scope_json: string[];
  default_time_range: string;
  created_at: string | null;
};

export type AIHealth = {
  ollama_reachable: boolean;
  ollama_error: string | null;
  model_configured: boolean;
  ollama_model: string;
  recent_llm_failures_estimate: number;
  suggestion_job_status: string;
};
