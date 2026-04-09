import type { AIChatResponse } from "@/types/ai";

export function AiPlanSummary({ res }: { res: AIChatResponse | null }) {
  if (!res?.plan) return <p style={{ color: "var(--color-text-muted)" }}>No plan yet.</p>;
  const p = res.plan;
  return (
    <div style={{ fontSize: "0.88rem" }}>
      <p>
        <strong>Dataset:</strong> {p.dataset ?? "—"}
      </p>
      <p>
        <strong>Intent:</strong> {p.intent ?? "—"}
      </p>
      <p>
        <strong>Aggregation:</strong> {p.aggregation ?? "—"}
      </p>
      <p>
        <strong>Limit:</strong> {p.limit ?? "—"}
      </p>
      <p>
        <strong>Filters:</strong>
      </p>
      <pre
        style={{
          margin: 0,
          padding: "0.5rem",
          background: "var(--color-surface)",
          borderRadius: "var(--radius)",
          overflow: "auto",
          maxHeight: "240px",
          fontSize: "0.8rem",
        }}
      >
        {JSON.stringify(p.filters ?? {}, null, 2)}
      </pre>
      {p.include_payload ? (
        <p style={{ color: "#f9a825", marginTop: "0.5rem" }}>Debug/raw payload preview was requested (admin only).</p>
      ) : null}
    </div>
  );
}
