import type { AIChatResponse } from "@/types/ai";

export function AiResultsTable({ res }: { res: AIChatResponse | null }) {
  const sample = res?.results?.sample_rows;
  if (!Array.isArray(sample) || sample.length === 0) {
    return <p style={{ color: "var(--color-text-muted)" }}>No tabular sample rows for this answer.</p>;
  }
  const keys = Array.from(new Set(sample.flatMap((r) => (r && typeof r === "object" ? Object.keys(r as object) : []))));
  return (
    <div className="table-scroll-sticky" style={{ overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
        <thead>
          <tr>
            {keys.map((k) => (
              <th
                key={k}
                style={{
                  textAlign: "left",
                  padding: "0.4rem",
                  borderBottom: "1px solid var(--color-border)",
                  color: "var(--color-text-muted)",
                }}
              >
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sample.map((row, i) => (
            <tr key={i}>
              {keys.map((k) => (
                <td
                  key={k}
                  style={{
                    padding: "0.4rem",
                    borderBottom: "1px solid var(--color-border-subtle, #333)",
                    verticalAlign: "top",
                  }}
                >
                  {formatCell((row as Record<string, unknown>)[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 200);
  return String(v);
}
