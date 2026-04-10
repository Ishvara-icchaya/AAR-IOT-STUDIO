import { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { useShellMessage } from "@/layouts/shell/ShellMessageContext";
import type { DependencyItem, ResourceInUseDetail } from "@/types/integrity";

function entityLabel(t: string): string {
  const map: Record<string, string> = {
    workflow: "Workflow",
    dashboard: "Dashboard",
    published_service: "Published service",
    workflow_execution: "Workflow execution",
    raw_data_object: "Raw data",
    device: "Device",
    data_object: "Data object",
    site: "Site",
    static_ingestion: "Static ingestion",
    user_site: "User–site",
    device_endpoint: "Device endpoint",
    device_object: "Device object",
    summary: "Dependency",
  };
  return map[t] ?? t.replace(/_/g, " ");
}

type Props = {
  open: boolean;
  detail: ResourceInUseDetail | null;
  onClose: () => void;
};

export function ResourceInUseDialog({ open, detail, onClose }: Props) {
  const { pushMessage } = useShellMessage();
  const [busy, setBusy] = useState(false);

  if (!open || !detail) return null;

  const snapshot: ResourceInUseDetail = detail;

  async function onDeactivate() {
    const u = snapshot.deactivate_url?.trim();
    if (!u) return;
    setBusy(true);
    try {
      await apiFetch(u, { method: "POST" });
      pushMessage("success", "Resource deactivated.");
      onClose();
    } catch (e) {
      pushMessage("error", e instanceof Error ? e.message : "Deactivate failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="resource-in-use-overlay"
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 13000,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-in-use-title"
        style={{
          maxWidth: "min(520px, 100%)",
          width: "100%",
          background: "var(--color-bg-elevated, var(--color-bg))",
          color: "var(--color-text)",
          borderRadius: "var(--radius)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          padding: "1.25rem",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="resource-in-use-title" style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>
          Cannot delete
        </h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.92rem", lineHeight: 1.5 }}>{snapshot.message}</p>
        {snapshot.dependencies.length > 0 ? (
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "0.35rem" }}>
              Used by
            </div>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.88rem", lineHeight: 1.45 }}>
              {detail.dependencies.map((dep: DependencyItem, i: number) => (
                <li key={`${dep.entity_type}-${dep.entity_id}-${i}`}>
                  <span style={{ color: "var(--color-text-muted)" }}>{entityLabel(dep.entity_type)}:</span>{" "}
                  {dep.route_hint ? (
                    <Link to={dep.route_hint} onClick={onClose}>
                      {dep.label || dep.entity_id}
                    </Link>
                  ) : (
                    <span>{dep.label || dep.entity_id}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "0.45rem 0.85rem",
              borderRadius: "var(--radius)",
              border: "1px solid var(--color-border)",
              background: "transparent",
              color: "var(--color-text)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          {snapshot.deactivate_url ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDeactivate()}
              style={{
                padding: "0.45rem 0.85rem",
                borderRadius: "var(--radius)",
                border: "none",
                background: "var(--color-accent)",
                color: "var(--btn-on-accent)",
                cursor: busy ? "wait" : "pointer",
                fontFamily: "inherit",
                fontWeight: 600,
                opacity: busy ? 0.75 : 1,
              }}
            >
              {busy ? "Working…" : "Deactivate instead"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
