import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as dashApi from "@/api/dashboard";
import { useResourceInUse } from "@/contexts/ResourceInUseContext";
import { layoutToApiJson, useDashboardBuilderStore } from "@/stores/dashboardBuilderStore";

type Props = { dashboardId: string };

export function DashboardHeader({ dashboardId }: Props) {
  const { tryHandleResourceInUseError } = useResourceInUse();
  const nav = useNavigate();
  const name = useDashboardBuilderStore((s) => s.name);
  const description = useDashboardBuilderStore((s) => s.description);
  const status = useDashboardBuilderStore((s) => s.status);
  const isPrimary = useDashboardBuilderStore((s) => s.isPrimary);
  const layout = useDashboardBuilderStore((s) => s.layout);
  const dirty = useDashboardBuilderStore((s) => s.dirty);
  const setName = useDashboardBuilderStore((s) => s.setName);
  const setDescription = useDashboardBuilderStore((s) => s.setDescription);
  const markClean = useDashboardBuilderStore((s) => s.markClean);
  const setPreviewPayload = useDashboardBuilderStore((s) => s.setPreviewPayload);
  const setDashboardSettings = useDashboardBuilderStore((s) => s.setDashboardSettings);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSave() {
    setErr(null);
    setMsg(null);
    try {
      await dashApi.updateDashboard(dashboardId, {
        name: name.trim(),
        description: description.trim() || null,
        layout: layoutToApiJson(layout),
      });
      markClean();
      setMsg("Saved");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function onPreview() {
    setErr(null);
    try {
      const live = await dashApi.previewDashboard(dashboardId, { layout: layoutToApiJson(layout) });
      setPreviewPayload(live);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Preview failed");
    }
  }

  async function onFreeze() {
    setErr(null);
    try {
      await dashApi.updateDashboard(dashboardId, { layout: layoutToApiJson(layout) });
      await dashApi.freezeDashboard(dashboardId);
      const d = await dashApi.getDashboard(dashboardId);
      useDashboardBuilderStore.getState().resetFromServer(d!);
      setMsg("Frozen — opening live…");
      nav(`/dashboard/${dashboardId}/live`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Freeze failed");
    }
  }

  async function onUnfreeze() {
    setErr(null);
    try {
      await dashApi.unfreezeDashboard(dashboardId);
      const d = await dashApi.getDashboard(dashboardId);
      useDashboardBuilderStore.getState().resetFromServer(d!);
      setMsg("Unfrozen");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unfreeze failed");
    }
  }

  async function onPrimary() {
    setErr(null);
    try {
      await dashApi.setPrimaryDashboard(dashboardId);
      const d = await dashApi.getDashboard(dashboardId);
      useDashboardBuilderStore.getState().resetFromServer(d!);
      setMsg("Set as primary — opening live…");
      nav(`/dashboard/${dashboardId}/live`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Set primary failed");
    }
  }

  async function onDelete() {
    if (!confirm("Delete this dashboard?")) return;
    setErr(null);
    try {
      await dashApi.deleteDashboard(dashboardId);
      nav("/dashboard/list");
    } catch (e) {
      if (tryHandleResourceInUseError(e)) return;
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const frozen = status === "frozen";
  const refreshSec = layout.settings?.refreshIntervalSec ?? 30;
  const mapStyleUrl = layout.settings?.mapStyleUrl ?? "";

  return (
    <>
    <header className="dash-header">
      <div className="dash-header__titles">
        <label className="dash-header__label">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={frozen}
            className="dash-header__input"
          />
        </label>
        <label className="dash-header__label">
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={frozen}
            className="dash-header__input dash-header__input--wide"
          />
        </label>
      </div>
      <div className="dash-header__meta">
        <span className="dash-header__badge">{status}</span>
        {isPrimary && <span className="dash-header__badge dash-header__badge--accent">primary</span>}
        {dirty && <span className="dash-header__badge">unsaved</span>}
      </div>
      <div className="dash-header__actions">
        {msg && <span className="dash-header__ok">{msg}</span>}
        {err && <span className="dash-header__err">{err}</span>}
        <button type="button" className="dash-btn" onClick={() => void onSave()} disabled={frozen}>
          Save draft
        </button>
        <button type="button" className="dash-btn dash-btn--secondary" onClick={() => void onPreview()}>
          Preview
        </button>
        {frozen ? (
          <button type="button" className="dash-btn" onClick={() => void onUnfreeze()}>
            Unfreeze
          </button>
        ) : (
          <button type="button" className="dash-btn dash-btn--accent" onClick={() => void onFreeze()}>
            Freeze
          </button>
        )}
        <button type="button" className="dash-btn" onClick={() => void onPrimary()} disabled={!frozen}>
          Set primary
        </button>
        <Link to={`/dashboard/${dashboardId}/live`} className="dash-btn dash-btn--link">
          Live
        </Link>
        <button type="button" className="dash-btn dash-btn--danger" onClick={() => void onDelete()}>
          Delete
        </button>
      </div>
    </header>
    <details className="dash-header-settings" style={{ marginTop: "0.25rem" }}>
      <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
        Dashboard settings (live refresh & map style)
      </summary>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginTop: "0.5rem",
          padding: "0.5rem 0",
        }}
      >
        <label className="dash-header__label">
          Live refresh interval (seconds, 5–3600)
          <input
            type="number"
            min={5}
            max={3600}
            className="dash-header__input"
            disabled={frozen}
            value={refreshSec}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setDashboardSettings({ refreshIntervalSec: Math.min(3600, Math.max(5, n)) });
            }}
          />
        </label>
        <label className="dash-header__label">
          Map style URL (optional; overrides server default — see docs/DASHBOARD_MAP_TILES.md)
          <input
            className="dash-header__input dash-header__input--wide"
            disabled={frozen}
            placeholder="https://…"
            value={mapStyleUrl}
            onChange={(e) => setDashboardSettings({ mapStyleUrl: e.target.value.trim() || undefined })}
          />
        </label>
      </div>
    </details>
    </>
  );
}
