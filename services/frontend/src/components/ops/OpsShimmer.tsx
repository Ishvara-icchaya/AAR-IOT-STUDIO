export function OpsShimmerLine({ width = "100%" }: { width?: number | string }) {
  return (
    <span
      className="ops-shimmer ops-shimmer--line"
      style={{
        display: "inline-block",
        height: "0.65rem",
        width: typeof width === "number" ? `${width}px` : width,
        borderRadius: 4,
        verticalAlign: "middle",
      }}
    />
  );
}

export function OpsShimmerBlock({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`ops-shimmer ops-shimmer--block ${className ?? ""}`} style={{ borderRadius: "var(--radius)", minHeight: "4rem", ...style }} />;
}
