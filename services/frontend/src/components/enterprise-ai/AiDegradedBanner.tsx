import type { AIChatResponse } from "@/types/ai";

export function AiDegradedBanner({ res }: { res: AIChatResponse | null }) {
  if (!res?.degraded && !(res?.warnings?.length || res?.evidence?.warnings?.length)) return null;
  const w = [...(res.warnings ?? []), ...(res.evidence?.warnings ?? [])];
  return (
    <div
      style={{
        marginBottom: "0.75rem",
        padding: "0.6rem 0.75rem",
        borderRadius: "var(--radius)",
        background: "rgba(249, 168, 37, 0.12)",
        border: "1px solid rgba(249, 168, 37, 0.45)",
        fontSize: "0.88rem",
      }}
    >
      {res.degraded && (
        <p style={{ margin: 0, fontWeight: 600 }}>
          Degraded mode: structured data only (LLM unavailable or skipped).
        </p>
      )}
      {w.length > 0 && (
        <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.2rem" }}>
          {w.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
