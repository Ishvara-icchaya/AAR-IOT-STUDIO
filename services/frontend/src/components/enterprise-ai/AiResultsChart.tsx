import type { AIChatResponse } from "@/types/ai";

/** Simple numeric bars until a chart library renders structured metrics. */
export function AiResultsChart({ res }: { res: AIChatResponse | null }) {
  const cats = res?.results?.categories;
  const bySev = res?.results?.by_severity;
  const hasBar = (Array.isArray(cats) && cats.length > 0) || (bySev && typeof bySev === "object");

  if (!hasBar) {
    return (
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.88rem" }}>
        No simple chart for this result type. See the Results table or Evidence tab.
      </p>
    );
  }

  const rows: { label: string; value: number }[] = [];
  if (Array.isArray(cats)) {
    for (const c of cats) {
      if (c && typeof c === "object" && "name" in c && "count" in c) {
        rows.push({ label: String((c as { name: unknown }).name), value: Number((c as { count: unknown }).count) });
      }
    }
  } else if (bySev && typeof bySev === "object") {
    for (const [k, v] of Object.entries(bySev as Record<string, unknown>)) {
      rows.push({ label: k, value: Number(v) || 0 });
    }
  }

  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", maxWidth: "420px" }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
            <span>{r.label}</span>
            <span>{r.value}</span>
          </div>
          <div
            style={{
              height: "8px",
              background: "var(--color-border)",
              borderRadius: "4px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${(r.value / max) * 100}%`,
                height: "100%",
                background: "var(--color-accent)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
