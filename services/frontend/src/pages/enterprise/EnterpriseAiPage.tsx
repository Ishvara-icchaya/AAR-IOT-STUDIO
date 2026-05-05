import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/api/client";
import {
  deleteAiSavedQuery,
  getAiDatasets,
  getAiHealth,
  getAiRecentQueries,
  getAiSavedQueries,
  getAiSuggestions,
  postAiChat,
  postAiSaveQuery,
} from "@/api/ai";
import { useOpsShell, type OpsTimeRange } from "@/contexts/OpsShellContext";
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
import { AppTabs } from "@/components/app";
import { OpsFilterPanel } from "@/components/ops/OpsFilterPanel";
import { OpsScopeControls } from "@/components/ops/OpsScopeControls";
import { PageShell } from "@/layouts/PageShell";
import { useShellMessage } from "@/layouts/shell";
import type { AIDatasetMeta, AIChatResponse, AIHealth, AIRecentQuery, AISavedQuery, AISuggestionItem } from "@/types/ai";

import "../device-register-page.css";
import "./enterprise-ai.css";

type SiteRow = { id: string; name: string; description: string | null };

type TabId = "answer" | "evidence" | "plan" | "results";

const RESULT_TABS: { id: TabId; label: string }[] = [
  { id: "answer", label: "Answer" },
  { id: "evidence", label: "Evidence" },
  { id: "plan", label: "Plan" },
  { id: "results", label: "Data" },
];

const CONCISE_ANSWER_MAX = 280;

/** Same copy as `ai_service._structured_answer` when the query returns zero rows. */
const NO_MATCHING_ROWS_MESSAGE = "No matching rows were found for your site scope and time range.";

/** Shown when the API set `degraded` after a failed summarization step (structured answer still returned). */
function degradedShellNotice(res: AIChatResponse): string {
  const merged = [...(res.warnings ?? []), ...(res.evidence?.warnings ?? [])];
  const detail = merged.find((s) => /llm|summar|ollama|model|unavailable/i.test(s));
  if (detail?.trim()) return detail.trim();
  return "Summarization did not run for this answer; the text below is still grounded in retrieved data.";
}

function conciseAnswerPreview(text: string | undefined | null): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  if (t.length <= CONCISE_ANSWER_MAX) return t;
  return `${t.slice(0, CONCISE_ANSWER_MAX).trim()}…`;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "—";
    const diff = Date.now() - t;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  } catch {
    return "—";
  }
}

function formatRowCount(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function opsTimeRangeToAiPreset(tr: OpsTimeRange): string {
  switch (tr) {
    case "1h":
    case "24h":
      return "last_24_hours";
    case "7d":
      return "last_7_days";
    case "30d":
      return "last_30_days";
    default:
      return "last_24_hours";
  }
}

/** API: omit site_ids for all permitted sites; single id when shell site is set. Saved-query overrides pass through. */
function siteIdsForAsk(opsSiteId: string | null, override?: string[] | null): string[] | undefined {
  if (override !== undefined && override !== null) {
    return override.length ? override : undefined;
  }
  const id = opsSiteId?.trim();
  return id ? [id] : undefined;
}

function healthScore(h: AIHealth | null): { pct: number; label: string } {
  if (!h) return { pct: 0, label: "Unknown" };
  let pct = 100;
  if (!h.ollama_reachable) pct -= 28;
  if (!h.model_configured) pct -= 12;
  pct -= Math.min(22, (h.recent_llm_failures_estimate ?? 0) * 3);
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  let label = "Operational";
  if (pct < 72) label = "Degraded";
  if (pct < 45) label = "At risk";
  return { pct, label };
}

export function EnterpriseAiPage() {
  const { pushMessage } = useShellMessage();
  const { siteId: opsSiteId, timeRange: opsTimeRange, refreshToken } = useOpsShell();
  const aiTimePreset = useMemo(() => opsTimeRangeToAiPreset(opsTimeRange), [opsTimeRange]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [useLlm, setUseLlm] = useState(true);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<AIChatResponse | null>(null);
  const [tab, setTab] = useState<TabId>("answer");
  const [health, setHealth] = useState<AIHealth | null>(null);
  const [datasets, setDatasets] = useState<AIDatasetMeta[]>([]);
  const [suggestions, setSuggestions] = useState<AISuggestionItem[]>([]);
  const [recent, setRecent] = useState<AIRecentQuery[]>([]);
  const [saved, setSaved] = useState<AISavedQuery[]>([]);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  /** Bumps on each successful `postAiChat` so footer notices fire once per response. */
  const responseFooterGen = useRef(0);
  const lastFooterGenHandled = useRef<number | null>(null);

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
    try {
      const ds = await getAiDatasets();
      setDatasets(ds?.items ?? []);
    } catch {
      setDatasets([]);
    }
  }, []);

  useEffect(() => {
    void loadSide();
  }, [loadSide, refreshToken]);

  useEffect(() => {
    if (!res) {
      lastFooterGenHandled.current = null;
      return;
    }
    const gen = responseFooterGen.current;
    if (lastFooterGenHandled.current === gen) return;
    lastFooterGenHandled.current = gen;

    if (res.degraded) {
      pushMessage("info", degradedShellNotice(res));
    }
    const answerTrim = (res.answer ?? "").trim();
    if (answerTrim === NO_MATCHING_ROWS_MESSAGE || answerTrim.includes(NO_MATCHING_ROWS_MESSAGE)) {
      pushMessage("info", NO_MATCHING_ROWS_MESSAGE);
    }
  }, [res, pushMessage]);

  const kpiHealth = useMemo(() => healthScore(health), [health]);

  async function runAsk(text: string, siteScopeOverride?: string[] | null, timeRangeOverride?: string | null) {
    const q = text.trim();
    if (!q) return;
    setErr(null);
    setLoading(true);
    setRes(null);
    try {
      const payload = {
        message: q,
        site_ids: siteIdsForAsk(opsSiteId, siteScopeOverride),
        time_range: (timeRangeOverride?.trim() || aiTimePreset) || "last_24_hours",
        use_llm: useLlm,
      };
      const data = await postAiChat(payload);
      if (!data) throw new Error("Empty response");
      responseFooterGen.current += 1;
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
        default_site_scope_json: opsSiteId?.trim() ? [opsSiteId.trim()] : [],
        default_time_range: aiTimePreset,
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

  const siteLabel = useMemo(() => {
    const id = opsSiteId?.trim();
    if (!id) return "All permitted sites";
    return sites.find((s) => s.id === id)?.name ?? `${id.slice(0, 8)}…`;
  }, [opsSiteId, sites]);

  return (
    <PageShell variant="list" className="enterprise-ai-page device-manage-page">
      <div className="dm-root ea-root">
        <OpsFilterPanel ariaLabel="Enterprise AI scope">
          <div className="dm-controls-form__row">
            <OpsScopeControls variant="filters" timeRangeLabel="Range" />
          </div>
        </OpsFilterPanel>
        {health && !health.ollama_reachable ? (
          <PageStatus variant="warning">
            <p style={{ margin: 0 }}>
              <strong>LLM summaries are offline.</strong> Structured KPIs, alerts, and evidence still work; natural-language answers need
              Ollama running where the API can reach it.
            </p>
            {health.ollama_error ? (
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.88rem", color: "var(--color-text-muted)" }}>{health.ollama_error}</p>
            ) : null}
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
              Configure <code>OLLAMA_BASE_URL</code> and <code>OLLAMA_MODEL</code>, ensure the model is pulled on the Ollama host, then reload
              this page.
            </p>
          </PageStatus>
        ) : null}

        <section className="dm-kpi-row dm-kpi-row--equal-4" aria-label="Assistant metrics">
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Approved datasets</div>
              <div className="dm-kpi__value">{datasets.length || "—"}</div>
              <div className="dm-kpi__sub">Catalog entries</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Rows (last retrieval)</div>
              <div className="dm-kpi__value">{formatRowCount(res?.evidence.rows_returned)}</div>
              <div className="dm-kpi__sub">Grounded in evidence</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Last activity</div>
              <div className="dm-kpi__value">{formatRelative(recent[0]?.created_at)}</div>
              <div className="dm-kpi__sub">{recent[0] ? "Recent query" : "No queries yet"}</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">System health</div>
              <div className="dm-kpi__value">{health ? `${kpiHealth.pct}%` : "—"}</div>
              <div className="dm-kpi__sub">{health ? `${kpiHealth.label} · ${siteLabel}` : "LLM status unknown"}</div>
            </div>
          </div>
        </section>

        <div className="ea-main">
          <section className="dm-filter-panel ea-stack ea-stack--scroll" aria-labelledby="ea-suggested-title">
            <h2 id="ea-suggested-title" className="dm-section-heading">
              Suggestions
            </h2>
            <AiSuggestedQueries items={suggestions} onPick={(p) => setMessage(p)} />
            <p className="ea-disclaimer">AI may make mistakes. Verify important details in Evidence and Data.</p>
          </section>

          <section className="dm-filter-panel ea-stack ea-stack--scroll" aria-labelledby="ea-ask-title">
            <h2 id="ea-ask-title" className="dm-section-heading">
              Ask
            </h2>
            <AiPromptBar
              useLlm={useLlm}
              onUseLlmChange={setUseLlm}
              message={message}
              onMessageChange={setMessage}
              onSubmit={() => void runAsk(message)}
              loading={loading}
            />
          </section>

          <section className="dm-filter-panel ea-stack ea-stack--results" aria-labelledby="ea-results-title">
            <h2 id="ea-results-title" className="dm-section-heading">
              Results
            </h2>
            {res?.answer?.trim() ? (
              <div className="ea-concise-answer" role="region" aria-label="Answer preview">
                <div className="ea-concise-answer__label">Response</div>
                <p className="ea-concise-answer__text">{conciseAnswerPreview(res.answer)}</p>
                {res.answer.trim().length > CONCISE_ANSWER_MAX ? (
                  <button type="button" className="ea-concise-answer__more" onClick={() => setTab("answer")}>
                    Open full answer
                  </button>
                ) : null}
              </div>
            ) : null}
            <AiDegradedBanner res={res} />
            {err ? <PageStatus variant="error">{err}</PageStatus> : null}
            <div className="ea-results-tabs">
              <AppTabs tabs={RESULT_TABS} active={tab} onChange={setTab} plain ariaLabel="Result views" />
            </div>
            <div className="ea-results-body">
              {tab === "answer" && <AiAnswerCard res={res} emptyStyle="hero" compact />}
              {tab === "evidence" && <AiEvidencePanel res={res} />}
              {tab === "plan" && <AiPlanSummary res={res} />}
              {tab === "results" && (
                <div>
                  <AiResultsChart res={res} />
                  <h4 className="ea-results-sample-heading">Sample rows</h4>
                  <AiResultsTable res={res} />
                </div>
              )}
            </div>
            <p className="ea-results-foot">Powered by approved platform datasets.</p>
          </section>
        </div>

        <div className="ea-bottom">
          <section className="dm-filter-panel ea-stack" id="ea-recent">
            <h2 className="dm-section-heading">Recent queries</h2>
            <AiRecentQueries items={recent} onReuse={(q) => setMessage(q)} />
          </section>
          <section className="dm-filter-panel ea-stack" id="ea-saved">
            <h2 className="dm-section-heading">Saved queries</h2>
            <AiSavedQueries
              items={saved}
              saveName={saveName}
              onSaveName={setSaveName}
              onSave={() => void handleSave()}
              onRun={(s) => {
                setMessage(s.question);
                void runAsk(s.question, s.default_site_scope_json ?? null, s.default_time_range || null);
              }}
              onDelete={(id) => void handleDeleteSaved(id)}
              saving={saving}
            />
          </section>
        </div>
      </div>
    </PageShell>
  );
}
