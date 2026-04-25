import { useCallback, useEffect, useState } from "react";
import { fetchLlmConfig, putLlmConfig, resetLlmConfig, testLlmConfig } from "@/api/llmConfig";
import { LlmConfigForm } from "@/components/admin/LlmConfigForm";
import { useConfirmAction } from "@/contexts/ConfirmActionContext";
import { PageShell } from "@/layouts/PageShell";
import { useShellMessage } from "@/layouts/shell";
import type { LlmConfigDTO, LlmConfigUpdateDTO } from "@/types/llmConfig";

function dtoToUpdate(d: LlmConfigDTO): LlmConfigUpdateDTO {
  return {
    provider: d.provider,
    base_url: d.base_url,
    model_name: d.model_name,
    timeout_seconds: d.timeout_seconds,
    max_rows: d.max_rows,
    max_prompt_chars: d.max_prompt_chars,
    query_timeout_seconds: d.query_timeout_seconds,
    rate_limit_per_min: d.rate_limit_per_min,
    enable_llm: d.enable_llm,
    enable_suggestions: d.enable_suggestions,
    enable_raw_debug: d.enable_raw_debug,
    llm_failure_threshold: d.llm_failure_threshold,
    llm_cooldown_seconds: d.llm_cooldown_seconds,
    pipeline_failure_threshold: d.pipeline_failure_threshold,
    pipeline_cooldown_seconds: d.pipeline_cooldown_seconds,
    summary_prompt: d.summary_prompt,
    incident_prompt: d.incident_prompt,
    trend_prompt: d.trend_prompt,
  };
}

export function LlmConfigPage() {
  const confirm = useConfirmAction();
  const { pushMessage, clearMessages } = useShellMessage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [form, setForm] = useState<LlmConfigUpdateDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setTestMessage(null);
    try {
      const d = await fetchLlmConfig();
      if (d) setForm(dtoToUpdate(d));
    } catch (e) {
      pushMessage("error", e instanceof Error ? e.message : "Failed to load LLM config");
    } finally {
      setLoading(false);
    }
  }, [pushMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback((p: Partial<LlmConfigUpdateDTO>) => {
    setForm((f) => (f ? { ...f, ...p } : f));
  }, []);

  async function onSave() {
    if (!form) return;
    clearMessages();
    setSaving(true);
    try {
      const out = await putLlmConfig(form);
      if (out) setForm(dtoToUpdate(out));
      pushMessage("success", "LLM configuration saved.");
    } catch (e) {
      pushMessage("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onReset() {
    const ok = await confirm({
      title: "Reset LLM configuration?",
      message: "Stored overrides will be removed and environment defaults restored.",
      confirmLabel: "Reset configuration",
      variant: "warning",
    });
    if (!ok) return;
    clearMessages();
    setSaving(true);
    try {
      const r = await resetLlmConfig();
      if (r?.config) setForm(dtoToUpdate(r.config));
      pushMessage("success", "Configuration reset to defaults.");
    } catch (e) {
      pushMessage("error", e instanceof Error ? e.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setTestMessage(null);
    try {
      const r = await testLlmConfig();
      if (r) {
        setTestMessage(
          `${r.success ? "OK" : "Failed"}: ${r.message}` +
            (r.available_models?.length ? ` — models: ${r.available_models.slice(0, 8).join(", ")}` : ""),
        );
        pushMessage(r.success ? "info" : "warning", r.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Test failed";
      setTestMessage(msg);
      pushMessage("error", msg);
    } finally {
      setTesting(false);
    }
  }

  if (loading || !form) {
    return (
      <PageShell>
        <p>Loading…</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <p className="admin-lead">Enterprise AI control plane for this customer tenant.</p>
      <LlmConfigForm
        value={form}
        onChange={patch}
        isAdmin={true}
        saving={saving}
        testing={testing}
        testMessage={testMessage}
        onTest={onTest}
        onSave={onSave}
        onReset={onReset}
      />
    </PageShell>
  );
}
