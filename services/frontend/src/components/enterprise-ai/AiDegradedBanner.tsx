import type { AIChatResponse } from "@/types/ai";

/** Inline warnings only; degraded “structured only” line is shown in the shell footer (Enterprise AI page). */
export function AiDegradedBanner({ res }: { res: AIChatResponse | null }) {
  if (!(res?.warnings?.length || res?.evidence?.warnings?.length)) return null;
  const raw = [...(res.warnings ?? []), ...(res.evidence?.warnings ?? [])];
  const w = raw.filter((x) => {
    if (!res.degraded) return true;
    const t = x.toLowerCase();
    if (t.includes("llm unavailable") && t.includes("structured")) return false;
    return true;
  });
  if (!w.length) return null;
  return (
    <div className="ea-degraded-banner" role="status">
      <ul>
        {w.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
