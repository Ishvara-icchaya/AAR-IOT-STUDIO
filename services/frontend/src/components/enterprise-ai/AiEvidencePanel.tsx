import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { AIChatResponse } from "@/types/ai";

const chip: CSSProperties = {
  display: "inline-block",
  fontFamily: "ui-monospace, monospace",
  fontSize: "0.78rem",
  padding: "0.15rem 0.45rem",
  margin: "0 0.35rem 0.35rem 0",
  borderRadius: "4px",
  background: "rgba(100, 181, 246, 0.12)",
  border: "1px solid rgba(100, 181, 246, 0.35)",
};

export function AiEvidencePanel({ res }: { res: AIChatResponse | null }) {
  if (!res?.evidence) return <p style={{ color: "var(--color-text-muted)" }}>No evidence yet.</p>;
  const e = res.evidence;
  return (
    <div style={{ fontSize: "0.88rem" }}>
      <div style={{ marginBottom: "0.5rem" }}>
        <strong style={{ display: "block", marginBottom: "0.25rem" }}>Datasets used</strong>
        <div>
          {(e.datasets?.length ? e.datasets : ["—"]).map((d) => (
            <span key={d} style={chip}>
              {d}
            </span>
          ))}
        </div>
      </div>
      <p>
        <strong>Rows returned:</strong> {e.rows_returned}
        {e.rows_clamped || e.span_clamped ? (
          <span style={{ marginLeft: "0.35rem", fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
            (capped)
          </span>
        ) : null}
      </p>
      <p>
        <strong>Time range:</strong> {e.time_range ?? "—"}
      </p>
      <p>
        <strong>Filters applied:</strong>
      </p>
      <pre
        style={{
          margin: "0 0 0.75rem",
          padding: "0.5rem",
          background: "var(--color-surface)",
          borderRadius: "var(--radius)",
          overflow: "auto",
          maxHeight: "200px",
          fontSize: "0.8rem",
        }}
      >
        {JSON.stringify(e.filters_applied ?? {}, null, 2)}
      </pre>
      {e.source_pages && e.source_pages.length > 0 && (
        <div>
          <strong>Related pages</strong>
          <ul style={{ margin: "0.35rem 0", paddingLeft: "1.2rem" }}>
            {e.source_pages.map((hint, i) => {
              const path = hint.startsWith("/") ? hint : null;
              return (
                <li key={i}>
                  {path ? (
                    <Link to={path} style={{ color: "var(--color-accent)" }}>
                      {hint}
                    </Link>
                  ) : (
                    hint
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
