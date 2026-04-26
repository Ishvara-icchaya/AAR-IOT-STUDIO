import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import * as dashApi from "@/api/dashboard";
import { useConfirmAction } from "@/contexts/ConfirmActionContext";
import { useResourceInUse } from "@/contexts/ResourceInUseContext";
import { useShellMessage } from "@/layouts/shell/ShellMessageContext";
import { layoutToApiJson, useDashboardBuilderStore } from "@/stores/dashboardBuilderStore";

type Props = { dashboardId: string };

export function DashboardHeader({ dashboardId }: Props) {
  const { tryHandleResourceInUseError } = useResourceInUse();
  const confirm = useConfirmAction();
  const nav = useNavigate();
  const { pushMessage } = useShellMessage();
  const name = useDashboardBuilderStore((s) => s.name);
  const description = useDashboardBuilderStore((s) => s.description);
  const status = useDashboardBuilderStore((s) => s.status);
  const layout = useDashboardBuilderStore((s) => s.layout);
  const setName = useDashboardBuilderStore((s) => s.setName);
  const setDescription = useDashboardBuilderStore((s) => s.setDescription);
  const markClean = useDashboardBuilderStore((s) => s.markClean);

  const [err, setErr] = useState<string | null>(null);

  async function onSave() {
    setErr(null);
    try {
      await dashApi.updateDashboard(dashboardId, {
        name: name.trim(),
        description: description.trim() || null,
        layout: layoutToApiJson(layout),
      });
      markClean();
      pushMessage("success", `Dashboard "${name.trim() || "Untitled"}" saved.`);
      nav("/dashboard/list");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Save failed";
      setErr(message);
      pushMessage("error", `Save failed: ${message}`);
    }
  }

  async function onFreeze() {
    setErr(null);
    try {
      await dashApi.updateDashboard(dashboardId, { layout: layoutToApiJson(layout) });
      await dashApi.freezeDashboard(dashboardId);
      markClean();
      pushMessage("success", `Dashboard "${name.trim() || "Untitled"}" frozen and saved.`);
      nav("/dashboard/list");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Freeze failed";
      setErr(message);
      pushMessage("error", `Freeze failed: ${message}`);
    }
  }

  async function onUnfreeze() {
    setErr(null);
    try {
      await dashApi.unfreezeDashboard(dashboardId);
      const d = await dashApi.getDashboard(dashboardId);
      useDashboardBuilderStore.getState().resetFromServer(d!);
      pushMessage("success", `Dashboard "${name.trim() || "Untitled"}" unfrozen.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unfreeze failed";
      setErr(message);
      pushMessage("error", `Unfreeze failed: ${message}`);
    }
  }

  async function onPrimary() {
    setErr(null);
    try {
      await dashApi.updateDashboard(dashboardId, { layout: layoutToApiJson(layout) });
      if (!frozen) {
        await dashApi.freezeDashboard(dashboardId);
      }
      await dashApi.setPrimaryDashboard(dashboardId);
      markClean();
      pushMessage("success", `Dashboard "${name.trim() || "Untitled"}" set as primary.`);
      nav("/dashboard/list");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Set primary failed";
      setErr(message);
      pushMessage("error", `Set primary failed: ${message}`);
    }
  }

  async function onResetDefaultLayout() {
    const ok = await confirm({
      title: "Reset to default layout?",
      message: "This removes all custom widgets. Dashboard name and ownership are kept.",
      confirmLabel: "Reset layout",
      variant: "warning",
    });
    if (!ok) {
      return;
    }
    setErr(null);
    try {
      const d = await dashApi.resetDashboardDefaultLayout(dashboardId);
      useDashboardBuilderStore.getState().resetFromServer(d!);
      pushMessage("success", "Dashboard layout reset to default template.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Reset failed";
      setErr(message);
      pushMessage("error", `Reset failed: ${message}`);
    }
  }

  async function onDelete() {
    const ok = await confirm({
      title: "Delete this dashboard?",
      message: "This action cannot be undone.",
      confirmLabel: "Delete dashboard",
      variant: "danger",
      requireText: "DELETE",
    });
    if (!ok) return;
    setErr(null);
    try {
      await dashApi.deleteDashboard(dashboardId);
      pushMessage("success", "Dashboard deleted.");
      nav("/dashboard/list");
    } catch (e) {
      if (tryHandleResourceInUseError(e)) return;
      const message = e instanceof Error ? e.message : "Delete failed";
      setErr(message);
      pushMessage("error", `Delete failed: ${message}`);
    }
  }

  const frozen = status === "frozen";

  return (
    <header className="dash-header">
      <nav className="dash-header__subnav" aria-label="Dashboard navigation">
        <Link to="/dashboard/list" className="scrubber2-subnav__back">
          <ArrowLeft size={16} strokeWidth={2} aria-hidden />
          Dashboard List
        </Link>
        <span className="dash-header__subnav-hint">
          {" "}
          / Create dashboard — build or edit Dashboard; return to the list anytime.
        </span>
      </nav>
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
      <div className="dash-header__actions">
        {err && <span className="dash-header__err">{err}</span>}
        <button type="button" className="dm-btn dm-btn--outline" onClick={() => void onSave()}>
          Save
        </button>
        {frozen ? (
          <button type="button" className="dm-btn dm-btn--outline" onClick={() => void onUnfreeze()}>
            Unfreeze
          </button>
        ) : (
          <button type="button" className="dm-btn dm-btn--outline" onClick={() => void onFreeze()}>
            Freeze
          </button>
        )}
        <button type="button" className="dm-btn dm-btn--outline" onClick={() => void onPrimary()}>
          Set primary
        </button>
        <Link to={`/dashboard/${dashboardId}/live`} className="dm-btn dm-btn--outline">
          Live
        </Link>
        {!frozen ? (
          <button type="button" className="dm-btn dm-btn--outline" onClick={() => void onResetDefaultLayout()}>
            Reset to Default
          </button>
        ) : null}
        <button type="button" className="dm-btn dm-btn--outline" onClick={() => void onDelete()}>
          Delete
        </button>
      </div>
    </header>
  );
}
