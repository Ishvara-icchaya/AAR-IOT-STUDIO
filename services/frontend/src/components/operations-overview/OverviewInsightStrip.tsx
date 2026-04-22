import type { SummarySegment } from "./operationsOverviewCommandCenter";

export function OverviewInsightStrip({ segments }: { segments: SummarySegment[] }) {
  if (!segments.length) return null;
  return (
    <div className="ops-insight-strip" role="status" aria-label="Operational summary">
      {segments.map((s, i) => (
        <span key={`${s.text}-${i}`} className={`ops-insight-strip__item ops-insight-strip__item--${s.tone}`}>
          {s.text}
        </span>
      ))}
    </div>
  );
}
