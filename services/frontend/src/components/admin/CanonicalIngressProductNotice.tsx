/** Points operators to the canonical multi-protocol ingress product spec in the repo. */

export function CanonicalIngressProductNotice() {
  return (
    <aside
      style={{
        marginBottom: "1rem",
        padding: "0.75rem 1rem",
        borderRadius: "var(--radius)",
        border: "1px solid var(--color-border)",
        background: "var(--color-surface-elevated, var(--color-surface))",
        fontSize: "0.85rem",
        color: "var(--color-text-muted)",
      }}
    >
      <strong style={{ color: "var(--color-text)" }}>Canonical ingress</strong> — MQTT, REST, CoAP, and WebSocket must all
      use the same pipeline (raw object → MinIO → Postgres → <code>raw.ingest</code> → worker-ingest). Product requirements
      and monitoring/alert expectations: repository file{" "}
      <code style={{ color: "var(--color-accent)" }}>docs/CANONICAL_INGRESS_PRODUCT.md</code>.
    </aside>
  );
}
