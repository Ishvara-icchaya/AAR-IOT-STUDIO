/** Compact sparkline for map popup trend tables (uses currentColor). */

export function formatTrendLocalTime(ts: string): string {
  const s = String(ts ?? "").trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type Props = {
  values: Array<number | null | undefined>;
  width?: number;
  height?: number;
};

export function MapTrendSparkline({ values, width = 88, height = 26 }: Props) {
  const finite = values
    .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
    .filter((v): v is number => v != null);
  if (finite.length < 2) {
    return <span className="dash-map-popup__spark-empty">—</span>;
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const pad = 2;
  const pw = width - 2 * pad;
  const ph = height - 2 * pad;
  const step = finite.length > 1 ? pw / (finite.length - 1) : 0;
  const pts = finite
    .map((v, i) => {
      const x = pad + i * step;
      const y = pad + ph - ((v - min) / span) * ph;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      className="dash-map-popup__spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
        vectorEffect="non-scaling-stroke"
        opacity={0.92}
      />
    </svg>
  );
}
