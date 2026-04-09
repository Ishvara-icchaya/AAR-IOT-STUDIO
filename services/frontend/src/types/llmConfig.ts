export type LlmConfigDTO = {
  customer_id: string;
  provider: string;
  base_url: string;
  model_name: string;
  timeout_seconds: number;
  max_rows: number;
  max_prompt_chars: number;
  query_timeout_seconds: number;
  rate_limit_per_min: number;
  enable_llm: boolean;
  enable_suggestions: boolean;
  enable_raw_debug: boolean;
  llm_failure_threshold: number;
  llm_cooldown_seconds: number;
  pipeline_failure_threshold: number;
  pipeline_cooldown_seconds: number;
  summary_prompt: string | null;
  incident_prompt: string | null;
  trend_prompt: string | null;
  updated_at: string;
};

export type LlmConfigUpdateDTO = Omit<
  LlmConfigDTO,
  "customer_id" | "updated_at"
>;

export type LlmConfigTestResponse = {
  success: boolean;
  provider: string;
  base_url: string;
  model_name: string;
  message: string;
  available_models?: string[] | null;
};

export type LlmConfigResetResponse = {
  success: boolean;
  config: LlmConfigDTO;
};
