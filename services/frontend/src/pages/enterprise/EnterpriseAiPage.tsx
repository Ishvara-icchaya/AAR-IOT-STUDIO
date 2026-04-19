import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/api/client";
import {
  deleteAiSavedQuery,
  getAiHealth,
  getAiRecentQueries,
  getAiSavedQueries,
  getAiSuggestions,
  postAiChat,
  postAiSaveQuery,
} from "@/api/ai";
import { useAuth } from "@/auth/AuthContext";
import { AiAnswerCard } from "@/components/enterprise-ai/AiAnswerCard";
import { AiDegradedBanner } from "@/components/enterprise-ai/AiDegradedBanner";
import { AiEvidencePanel } from "@/components/enterprise-ai/AiEvidencePanel";
import { AiPlanSummary } from "@/components/enterprise-ai/AiPlanSummary";
import { AiPromptBar } from "@/components/enterprise-ai/AiPromptBar";
import { AiRecentQueries } from "@/components/enterprise-ai/AiRecentQueries";
import { AiResultsChart } from "@/components/enterprise-ai/AiResultsChart";
import { AiResultsTable } from "@/components/enterprise-ai/AiResultsTable";
import { AiSavedQueries } from "@/components/enterprise-ai/AiSavedQueries";
import { AiSuggestedQueries } from "@/components/enterprise-ai/AiSuggestedQueries";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";
import type { AIChatResponse, AIHealth, AIRecentQuery, AISavedQuery, AISuggestionItem } from "@/types/ai";

type SiteRow = { id: string; name: string; description: string | null };

type TabId = "answer" | "evidence" | "plan" | "results";

const tabBar: CSSProperties = { display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "0.75rem" };

export function EnterpriseAiPage() {
  const { me } = useAuth();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState("last_24_hours");
  const [useLlm, setUseLlm] = useState(true);
  const [debugRaw, setDebugRaw] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<AIChatResponse | null>(null);
  const [tab, setTab] = useState<TabId>("answer");
  const [health, setHealth] = useState<AIHealth | null>(null);
  const [suggestions, setSuggestions] = useState<AISuggestionItem[]>([]);
  const [recent, setRecent] = useState<AIRecentQuery[]>([]);
  const [saved, setSaved] = useState<AISavedQuery[]>([]);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  const showDebug = Boolean(me?.is_superuser || me?.role === "admin");

  const loadSide = useCallback(async () => {
    try {
      const [h, su, re, sa, siteList] = await Promise.all([
        getAiHealth(),
        getAiSuggestions(),
        getAiRecentQueries(20),
        getAiSavedQueries(),
        apiFetch<SiteRow[]>("/administration/sites"),
      ]);
      setHealth(h ?? null);
      setSuggestions(su?.items ?? []);
      setRecent(re ?? []);
      setSaved(sa ?? []);
      setSites(siteList ?? []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadSide();
  }, [loadSide]);

  async function runAsk(text: string) {
    const q = text.trim();
    if (!q) return;
    setErr(null);
    setLoading(true);
    setRes(null);
    try {
      const payload = {
        message: q,
        site_ids: selectedSiteIds.length ? selectedSiteIds : undefined,
        time_range: timeRange,
        use_llm: useLlm,
        debug_raw: showDebug && debugRaw,
      };
      const data = await postAiChat(payload);
      if (!data) throw new Error("Empty response");
      setRes(data);
      setTab("answer");
      void loadSide();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!saveName.trim() || !message.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await postAiSaveQuery({
        name: saveName.trim(),
        question: message.trim(),
        default_site_scope_json: selectedSiteIds,
        default_time_range: timeRange,
      });
      setSaveName("");
      void loadSide();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSaved(id: string) {
    try {
      await deleteAiSavedQuery(id);
      void loadSide();
    } catch {
      /* ignore */
    }
  }

  function tabBtn(id: TabId, label: string) {
    const active = tab === id;
    return (
      <button
        type="button"
        key={id}
        onClick={() => setTab(id)}
        style={{
          padding: "0.35rem 0.65rem",
          borderRadius: "var(--radius)",
          border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
          background: active ? "rgba(255,255,255,0.08)" : "transparent",
          color: "var(--color-text)",
          cursor: "pointer",
          fontSize: "0.85rem",
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <PageShell title="Enterprise AI" className="enterprise-ai-page">
      <div className="enterprise-ai-page__body">
        <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)" }}>
        Answers are grounded in approved platform datasets only. The LLM never executes SQL or sees raw user instructions
        as code — it only summarizes structured rows already retrieved for your site scope.
        </p>

        {health && (
          <div
            style={{
              fontSize: "0.82rem",
              marginBottom: "1rem",
              padding: "0.5rem 0.65rem",
              borderRadius: "var(--radius)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-muted)",
            }}
          >
            Ollama: {health.ollama_reachable ? "reachable" : "unreachable"}
            {health.ollama_model ? ` · model ${health.ollama_model}` : ""}
            {!health.ollama_reachable && health.ollama_error ? ` — ${health.ollama_error}` : ""}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
            gap: "1.25rem",
            alignItems: "start",
          }}
        >
          <div>
            <h2 style={{ fontSize: "1rem" }}>Ask</h2>
            <AiPromptBar
              sites={sites}
              selectedSiteIds={selectedSiteIds}
              onSitesChange={setSelectedSiteIds}
              timeRange={timeRange}
              onTimeRangeChange={setTimeRange}
              useLlm={useLlm}
              onUseLlmChange={setUseLlm}
              debugRaw={debugRaw}
              onDebugRawChange={setDebugRaw}
              showDebug={showDebug}
              message={message}
              onMessageChange={setMessage}
              onSubmit={() => void runAsk(message)}
              loading={loading}
            />
            <h3 style={{ fontSize: "0.95rem" }}>Suggested</h3>
            <AiSuggestedQueries items={suggestions} onPick={(p) => setMessage(p)} />
          </div>

          <div>
            <AiDegradedBanner res={res} />
            {err ? <PageStatus variant="error">{err}</PageStatus> : null}
            <div style={tabBar}>
              {tabBtn("answer", "Answer")}
              {tabBtn("evidence", "Evidence")}
              {tabBtn("plan", "Plan")}
              {tabBtn("results", "Results")}
            </div>
            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                padding: "1rem",
                minHeight: "200px",
              }}
            >
              {tab === "answer" && <AiAnswerCard res={res} />}
              {tab === "evidence" && <AiEvidencePanel res={res} />}
              {tab === "plan" && <AiPlanSummary res={res} />}
              {tab === "results" && (
                <div>
                  <AiResultsChart res={res} />
                  <h4 style={{ fontSize: "0.9rem", marginTop: "1rem" }}>Sample rows</h4>
                  <AiResultsTable res={res} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: "2rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
            gap: "1.25rem",
          }}
        >
          <div>
            <h2 style={{ fontSize: "1rem" }}>Recent queries</h2>
            <AiRecentQueries items={recent} onReuse={(q) => setMessage(q)} />
          </div>
          <div>
            <h2 style={{ fontSize: "1rem" }}>Saved queries</h2>
            <AiSavedQueries
              items={saved}
              saveName={saveName}
              onSaveName={setSaveName}
              onSave={() => void handleSave()}
              onRun={(s) => {
                setMessage(s.question);
                setSelectedSiteIds(s.default_site_scope_json ?? []);
                setTimeRange(s.default_time_range || "last_24_hours");
                void runAsk(s.question);
              }}
              onDelete={(id) => void handleDeleteSaved(id)}
              saving={saving}
            />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
