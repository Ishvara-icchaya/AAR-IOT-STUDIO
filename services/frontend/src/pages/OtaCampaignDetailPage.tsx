import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isApiHttpError } from "@/api/client";
import { listDevices, type DeviceRead, deviceDetailsUrl } from "@/api/devices";
import {
  addOtaCampaignTargets,
  approveOtaCampaign,
  cancelOtaCampaign,
  getOtaCampaign,
  launchOtaCampaign,
  listOtaCampaignEvents,
  pauseOtaCampaign,
  removeOtaCampaignTarget,
  reportOtaTargetStatus,
  resumeOtaCampaign,
  submitOtaCampaign,
  type OtaCampaignDetailRead,
  type OtaEventRead,
} from "@/api/ota";
import { OpsPageHeader } from "@/components/ops/OpsPageHeader";
import { OpsStatusPill, type OpsVariant } from "@/components/ops/OpsStatusPill";
import { AarButton } from "@/components/system/AarButton";
import { useSitePermissionKeys } from "@/hooks/useSitePermissionKeys";
import { PageShell } from "@/layouts/PageShell";
import { useShellMessage } from "@/layouts/shell/ShellMessageContext";

import "./ota-campaigns-page.css";

function statusVariant(s: string): OpsVariant {
  const x = (s || "").toLowerCase();
  if (x === "running" || x === "approved" || x === "success" || x === "command_sent" || x === "completed") return "online";
  if (x === "failed" || x === "rolled_back") return "offline";
  if (x === "paused" || x === "pending_approval" || x === "queued") return "waiting";
  return "muted";
}

const TERMINAL = new Set(["success", "failed", "rolled_back", "timeout", "cancelled"]);

function otaRolloutPhase(status: string): number {
  const x = (status || "").toLowerCase();
  if (x === "draft" || x === "simulation_required") return 0;
  if (x === "pending_approval") return 1;
  if (x === "approved") return 2;
  if (x === "running" || x === "paused") return 3;
  if (x === "completed" || x === "failed" || x === "rolled_back" || x === "cancelled") return 4;
  return 0;
}

const ROLLOUT_MILESTONES = [
  { label: "Prepare", hint: "Draft, targets, checks" },
  { label: "Approval", hint: "Submitted & reviewed" },
  { label: "Approved", hint: "Ready to launch" },
  { label: "Live", hint: "Running rollout" },
  { label: "Closed", hint: "Terminal outcome" },
] as const;

export function OtaCampaignDetailPage() {
  const { campaignId = "" } = useParams<{ campaignId: string }>();
  const { pushMessage } = useShellMessage();
  const [camp, setCamp] = useState<OtaCampaignDetailRead | null>(null);
  const sitePerm = useSitePermissionKeys(camp?.site_id);
  const [events, setEvents] = useState<OtaEventRead[]>([]);
  const [devices, setDevices] = useState<DeviceRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [simTarget, setSimTarget] = useState("");
  const [simStatus, setSimStatus] = useState<"success" | "failed" | "rolled_back" | "timeout" | "cancelled">("success");

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const [c, ev] = await Promise.all([
        getOtaCampaign(campaignId),
        listOtaCampaignEvents(campaignId).catch(() => ({ items: [] as OtaEventRead[] })),
      ]);
      setCamp(c);
      setEvents(ev?.items ?? []);
      if (c?.site_id) {
        const devs = await listDevices({ site_id: c.site_id }).catch(() => [] as DeviceRead[]);
        setDevices(devs ?? []);
      } else {
        setDevices([]);
      }
    } catch (e) {
      pushMessage("error", isApiHttpError(e) ? e.message : "Failed to load campaign");
      setCamp(null);
    } finally {
      setLoading(false);
    }
  }, [campaignId, pushMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  const targetDeviceIds = useMemo(() => new Set((camp?.targets ?? []).map((t) => t.device_id)), [camp]);

  const deviceName = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, d.name])), [devices]);

  const sid = camp?.site_id ?? "";
  const permsReady = Boolean(sid && !sitePerm.loading);
  const canOtaCreate = Boolean(permsReady && sitePerm.has("ota.create"));
  const canOtaApprove = Boolean(permsReady && sitePerm.has("ota.approve"));
  const canOtaLaunch = Boolean(permsReady && sitePerm.has("ota.launch"));
  const canOtaCancel = Boolean(permsReady && (sitePerm.has("ota.launch") || sitePerm.has("ota.rollback")));
  const canSimulate = Boolean(permsReady && sitePerm.has("simulation.run"));

  const phase = camp ? otaRolloutPhase(camp.status) : 0;
  const firstTargetDeviceId = (camp?.targets ?? [])[0]?.device_id;

  const demoRemoteTargetId = useMemo(() => {
    const t = (camp?.targets ?? []).find((x) => !TERMINAL.has(x.status));
    return t?.id ?? "";
  }, [camp]);

  const remoteSimulatorShellScript = useMemo(() => {
    const poll = camp?.simulator_poll_url;
    const status = camp?.simulator_status_url;
    if (!poll || !status) return "";
    const tid = demoRemoteTargetId;
    const ref = "remote-demo-1";
    const lines = [
      "# Poll pending work (GET, no auth — same secret as status URL)",
      `curl -sS ${JSON.stringify(poll)}`,
      "",
      "# Report terminal success (POST; use a fresh Idempotency-Key per attempt)",
    ];
    if (tid) {
      const payload = JSON.stringify({
        target_id: tid,
        status: "success",
        command_id: ref,
        ota_external_ref: ref,
      });
      lines.push(
        `curl -sS -X POST ${JSON.stringify(status)} \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "Idempotency-Key: ${tid.slice(0, 8)}-${ref}" \\`,
        `  -d ${JSON.stringify(payload)}`,
      );
    } else {
      lines.push(
        "# After the poll returns items, replace TARGET_ID with items[0].target_id (UUID):",
        `curl -sS -X POST ${JSON.stringify(status)} \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "Idempotency-Key: my-run-1" \\`,
        `  -d '{"target_id":"TARGET_ID","status":"success","command_id":"my-run-1","ota_external_ref":"my-run-1"}'`,
      );
    }
    return lines.join("\n");
  }, [camp, demoRemoteTargetId]);

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      pushMessage("success", okMsg);
      await load();
    } catch (e) {
      pushMessage("error", isApiHttpError(e) ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const addSelected = () => {
    const ids = Object.entries(pick)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!campaignId || ids.length === 0) return;
    void run(async () => {
      await addOtaCampaignTargets(campaignId, ids);
    }, "Targets added.");
    setPick({});
  };

  if (!campaignId) {
    return (
      <PageShell>
        <p>Missing campaign id.</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="ota-campaigns-page">
        <OpsPageHeader
          title={camp?.name ?? "OTA campaign"}
          subtitle={
            <span className="ota-campaigns-page__sub">
              <Link to="/devices/ota" className="dm-name-link">
                ← Campaign list
              </Link>
              {camp ? ` · ${camp.id.slice(0, 8)}…` : null}
            </span>
          }
        />
        {loading ? <p className="ota-campaigns-page__sub">Loading…</p> : null}
        {!loading && !camp ? <p className="ota-campaigns-page__sub">Campaign not found.</p> : null}
        {camp ? (
          <>
            <div className="ota-campaign-detail__actions">
              <OpsStatusPill status={camp.status} variant={statusVariant(camp.status)} />
              <span className="ota-campaigns-page__sub">Approval: {camp.approval_status}</span>
            </div>

            <div className="ota-rollout-timeline" aria-label="Rollout progress">
              {ROLLOUT_MILESTONES.map((m, i) => {
                const done = phase > i || phase === 4;
                const current = phase === i && phase < 4;
                return (
                  <div
                    key={m.label}
                    className={`ota-rollout-timeline__card${done ? " ota-rollout-timeline__card--done" : ""}${current ? " ota-rollout-timeline__card--current" : ""}`}
                  >
                    <div className="ota-rollout-timeline__label">{m.label}</div>
                    <div className="ota-rollout-timeline__hint">{m.hint}</div>
                  </div>
                );
              })}
            </div>

            <dl className="ota-campaign-detail__summary-grid">
              <div className="ota-campaign-detail__summary-card">
                <dt>Target firmware</dt>
                <dd>{camp.target_firmware_version?.trim() || "—"}</dd>
              </div>
              <div className="ota-campaign-detail__summary-card">
                <dt>Site</dt>
                <dd>{camp.site_id ? camp.site_id.slice(0, 8) + "…" : "—"}</dd>
              </div>
              <div className="ota-campaign-detail__summary-card">
                <dt>Created</dt>
                <dd>{new Date(camp.created_at).toLocaleString()}</dd>
              </div>
              <div className="ota-campaign-detail__summary-card">
                <dt>Started</dt>
                <dd>{camp.started_at ? new Date(camp.started_at).toLocaleString() : "—"}</dd>
              </div>
            </dl>
            {camp.rollout_strategy?.trim() ? (
              <p className="ota-campaigns-page__sub">
                <strong>Rollout notes:</strong> {camp.rollout_strategy}
              </p>
            ) : null}

            {camp.simulator_poll_url ? (
              <>
                <h3 className="ota-campaign-detail__section-title">Remote simulator (poll + status)</h3>
                <p className="ota-campaigns-page__sub">
                  Use these URLs from a remote OTA harness: the GET returns pending work (same shape as executor work). The
                  POST reports terminal status with the <strong>same URL token</strong> as the poll—no JWT or API bearer
                  required. Send header <code className="ota-campaign-detail__mono">Idempotency-Key</code> on every status
                  POST. Treat both URLs as secrets.
                </p>
                <label className="ota-campaigns-page__field">
                  GET — poll work
                  <input readOnly className="ota-wizard__mono" value={camp.simulator_poll_url} spellCheck={false} />
                </label>
                {camp.simulator_status_url ? (
                  <label className="ota-campaigns-page__field">
                    POST — terminal status (same token)
                    <input readOnly className="ota-wizard__mono" value={camp.simulator_status_url} spellCheck={false} />
                  </label>
                ) : null}
                <div className="ota-campaign-detail__actions">
                  <AarButton
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(camp.simulator_poll_url ?? "").then(
                        () => pushMessage("success", "Poll URL copied."),
                        () => pushMessage("error", "Could not copy."),
                      );
                    }}
                  >
                    Copy poll URL
                  </AarButton>
                  {camp.simulator_status_url ? (
                    <AarButton
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(camp.simulator_status_url ?? "").then(
                          () => pushMessage("success", "Status URL copied."),
                          () => pushMessage("error", "Could not copy."),
                        );
                      }}
                    >
                      Copy status URL
                    </AarButton>
                  ) : null}
                  {remoteSimulatorShellScript ? (
                    <AarButton
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(remoteSimulatorShellScript).then(
                          () => pushMessage("success", "Demo script copied."),
                          () => pushMessage("error", "Could not copy."),
                        );
                      }}
                    >
                      Copy curl demo
                    </AarButton>
                  ) : null}
                </div>
                {remoteSimulatorShellScript ? (
                  <label className="ota-campaigns-page__field">
                    Example shell (bash)
                    <textarea
                      readOnly
                      className="ota-wizard__mono"
                      rows={demoRemoteTargetId ? 10 : 12}
                      value={remoteSimulatorShellScript}
                      spellCheck={false}
                    />
                  </label>
                ) : null}
                <p className="ota-campaigns-page__sub">
                  If <code className="ota-campaign-detail__mono">POST …/status</code> returns 503, set{" "}
                  <code className="ota-campaign-detail__mono">OTA_API_ACTOR_USER_ID</code> on the API to a user in this
                  tenant, or ensure the campaign has a creator user for lineage attribution.
                </p>
              </>
            ) : null}

            {(camp.status === "draft" || camp.status === "simulation_required") && firstTargetDeviceId && canSimulate ? (
              <p className="ota-campaigns-page__sub">
                <Link className="dm-name-link" to={deviceDetailsUrl(firstTargetDeviceId, "simulation")}>
                  Run Replay Simulation
                </Link>{" "}
                on the first target device before submitting.
              </p>
            ) : null}

            <div className="ota-campaign-detail__actions">
              {camp.status === "draft" || camp.status === "simulation_required" ? (
                <AarButton
                  type="button"
                  variant="primary"
                  disabled={busy || !canOtaCreate}
                  title={!canOtaCreate ? "Requires ota.create for this site" : undefined}
                  onClick={() =>
                    void run(async () => {
                      await submitOtaCampaign(campaignId);
                    }, "Submitted for approval.")
                  }
                >
                  Submit For Approval
                </AarButton>
              ) : null}
              {camp.status === "pending_approval" ? (
                <AarButton
                  type="button"
                  variant="primary"
                  disabled={busy || !canOtaApprove}
                  title={!canOtaApprove ? "Requires ota.approve for this site" : undefined}
                  onClick={() =>
                    void run(async () => {
                      await approveOtaCampaign(campaignId);
                    }, "Campaign approved.")
                  }
                >
                  Approve
                </AarButton>
              ) : null}
              {camp.status === "approved" ? (
                <AarButton
                  type="button"
                  variant="primary"
                  disabled={busy || !canOtaLaunch}
                  title={!canOtaLaunch ? "Requires ota.launch for target device sites" : undefined}
                  onClick={() =>
                    void run(async () => {
                      await launchOtaCampaign(campaignId);
                    }, "Campaign launched.")
                  }
                >
                  Launch
                </AarButton>
              ) : null}
              {camp.status === "running" ? (
                <AarButton
                  type="button"
                  variant="outline"
                  disabled={busy || !canOtaLaunch}
                  onClick={() =>
                    void run(async () => {
                      await pauseOtaCampaign(campaignId);
                    }, "Paused.")
                  }
                >
                  Pause
                </AarButton>
              ) : null}
              {camp.status === "paused" ? (
                <AarButton
                  type="button"
                  variant="primary"
                  disabled={busy || !canOtaLaunch}
                  onClick={() =>
                    void run(async () => {
                      await resumeOtaCampaign(campaignId);
                    }, "Resumed.")
                  }
                >
                  Resume
                </AarButton>
              ) : null}
              {!["completed", "failed", "rolled_back", "cancelled"].includes(camp.status) ? (
                <AarButton
                  type="button"
                  variant="outline"
                  disabled={busy || !canOtaCancel}
                  title={!canOtaCancel ? "Requires ota.launch or ota.rollback" : undefined}
                  onClick={() =>
                    void run(async () => {
                      await cancelOtaCampaign(campaignId);
                    }, "Cancelled.")
                  }
                >
                  Cancel Rollout
                </AarButton>
              ) : null}
            </div>

            {(camp.status === "draft" || camp.status === "simulation_required") && camp.site_id ? (
              <>
                <h3 className="ota-campaign-detail__section-title">Add devices (draft)</h3>
                <p className="ota-campaigns-page__sub">Select devices in this site, then add as targets.</p>
                <div className="ota-campaign-detail__device-pick">
                  {devices
                    .filter((d) => !targetDeviceIds.has(d.id))
                    .map((d) => (
                      <label key={d.id}>
                        <input
                          type="checkbox"
                          checked={Boolean(pick[d.id])}
                          onChange={(e) => setPick((p) => ({ ...p, [d.id]: e.target.checked }))}
                        />
                        {d.name}
                      </label>
                    ))}
                  {devices.filter((d) => !targetDeviceIds.has(d.id)).length === 0 ? (
                    <p className="ota-campaigns-page__sub">No remaining devices, or load failed.</p>
                  ) : null}
                </div>
                <div className="ota-campaign-detail__actions">
                  <AarButton type="button" variant="primary" disabled={busy || !canOtaCreate} onClick={addSelected}>
                    Add Selected Targets
                  </AarButton>
                </div>
              </>
            ) : null}

            <h3 className="ota-campaign-detail__section-title">Targets</h3>
            <div className="dm-table-scroll">
              <table className="dm-data-table">
                <thead>
                  <tr>
                    <th className="dm-data-table__th">Device</th>
                    <th className="dm-data-table__th">Status</th>
                    <th className="dm-data-table__th">Current FW</th>
                    <th className="dm-data-table__th">Target FW</th>
                    <th className="dm-data-table__th dm-data-table__th--actions"> </th>
                  </tr>
                </thead>
                <tbody>
                  {(camp.targets ?? []).map((t) => (
                    <tr key={t.id} className="dm-data-table__row">
                      <td className="dm-data-table__td">
                        <Link className="dm-name-link" to={`/devices/detail/${encodeURIComponent(t.device_id)}`}>
                          {deviceName[t.device_id] ?? t.device_id.slice(0, 8) + "…"}
                        </Link>
                      </td>
                      <td className="dm-data-table__td">
                        <OpsStatusPill status={t.status} variant={statusVariant(t.status)} />
                      </td>
                      <td className="dm-data-table__td">{t.current_firmware_version ?? "—"}</td>
                      <td className="dm-data-table__td">{t.target_firmware_version ?? "—"}</td>
                      <td className="dm-data-table__td dm-data-table__td--actions">
                        {t.status === "queued" && (camp.status === "draft" || camp.status === "simulation_required") ? (
                          <AarButton
                            type="button"
                            variant="outline"
                            disabled={busy || !canOtaCreate}
                            onClick={() =>
                              void run(async () => {
                                await removeOtaCampaignTarget(campaignId, t.id);
                              }, "Target removed.")
                            }
                          >
                            Remove
                          </AarButton>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="ota-campaign-detail__section-title">Report terminal status (integration / test)</h3>
            <p className="ota-campaigns-page__sub">
              Calls <code className="ota-campaign-detail__mono">POST /ota/status</code> with{" "}
              <code className="ota-campaign-detail__mono">Idempotency-Key</code> (requires{" "}
              <code className="ota-campaign-detail__mono">ota.executor.status</code> or{" "}
              <code className="ota-campaign-detail__mono">ota.launch</code> on the device site).
            </p>
            <div className="ota-campaign-detail__actions" style={{ alignItems: "center" }}>
              <select value={simTarget} onChange={(e) => setSimTarget(e.target.value)}>
                <option value="">Target…</option>
                {(camp.targets ?? [])
                  .filter((t) => !TERMINAL.has(t.status))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {(deviceName[t.device_id] ?? t.device_id).slice(0, 40)} — {t.status}
                    </option>
                  ))}
              </select>
              <select value={simStatus} onChange={(e) => setSimStatus(e.target.value as typeof simStatus)}>
                <option value="success">success</option>
                <option value="failed">failed</option>
                <option value="rolled_back">rolled_back</option>
                <option value="timeout">timeout</option>
                <option value="cancelled">cancelled</option>
              </select>
              <AarButton
                type="button"
                variant="outline"
                disabled={busy || !simTarget || !canOtaLaunch}
                title={!canOtaLaunch ? "Requires ota.launch on device site" : undefined}
                onClick={() =>
                  void run(async () => {
                    const ref =
                      typeof crypto !== "undefined" && "randomUUID" in crypto
                        ? `sim-${crypto.randomUUID()}`
                        : `sim-${Date.now()}`;
                    await reportOtaTargetStatus(
                      {
                        target_id: simTarget,
                        status: simStatus,
                        ota_external_ref: ref,
                        command_id: ref,
                      },
                      { idempotencyKey: `${simTarget}:${ref}:${simStatus}` },
                    );
                  }, "Status reported.")
                }
              >
                Report Status
              </AarButton>
            </div>

            <h3 className="ota-campaign-detail__section-title">Events / logs</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {events.length === 0 ? <li className="ota-campaigns-page__sub">No events yet.</li> : null}
              {events.map((ev) => (
                <li key={ev.id} className="ota-campaign-detail__mono" style={{ marginBottom: 8 }}>
                  <strong>{ev.event_type}</strong> · {new Date(ev.created_at).toLocaleString()}
                  {ev.payload_json ? ` · ${JSON.stringify(ev.payload_json).slice(0, 160)}` : ""}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
