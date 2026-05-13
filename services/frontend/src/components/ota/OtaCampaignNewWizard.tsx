import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, ExternalLink } from "lucide-react";
import { apiFetch, isApiHttpError } from "@/api/client";
import { listDevices, type DeviceRead } from "@/api/devices";
import {
  addOtaCampaignTargets,
  approveOtaCampaign,
  createOtaArtifact,
  createOtaCampaign,
  getOtaCampaign,
  launchOtaCampaign,
  listOtaArtifacts,
  submitOtaCampaign,
  type FirmwareArtifactRead,
  type OtaCampaignRead,
} from "@/api/ota";
import { runReplaySimulation, type SimulationJobRead } from "@/api/simulations";
import { AarButton } from "@/components/system/AarButton";
import { useSitePermissionKeys } from "@/hooks/useSitePermissionKeys";
import { useShellMessage } from "@/layouts/shell/ShellMessageContext";
import { ICON_STROKE_WIDTH } from "@/lib/appIcons";

import "@/pages/ota-campaigns-page.css";

type SiteRow = { id: string; name: string };

const STEPS = ["Firmware Artifact", "Targets", "Review", "Submit / Launch"] as const;

function formatBytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function ArtifactPreview({ a }: { a: FirmwareArtifactRead }) {
  return (
    <dl className="ota-wizard__artifact-preview">
      <div>
        <dt>URL</dt>
        <dd>
          <a className="ota-wizard__artifact-link" href={a.artifact_url} target="_blank" rel="noreferrer">
            {a.artifact_url.length > 72 ? `${a.artifact_url.slice(0, 72)}…` : a.artifact_url}
            <ExternalLink size={12} strokeWidth={ICON_STROKE_WIDTH} aria-hidden style={{ marginLeft: 4, verticalAlign: "middle", opacity: 0.7 }} />
          </a>
        </dd>
      </div>
      <div>
        <dt>SHA-256</dt>
        <dd className="ota-wizard__mono">{a.sha256}</dd>
      </div>
      <div>
        <dt>Signature</dt>
        <dd className="ota-wizard__mono">
          {a.signature?.trim()
            ? a.signature.length > 48
              ? `${a.signature.slice(0, 48)}…`
              : a.signature
            : "—"}
        </dd>
      </div>
      <div>
        <dt>Algorithm</dt>
        <dd>{a.signature_algorithm ?? "—"}</dd>
      </div>
      <div>
        <dt>Size</dt>
        <dd>{formatBytes(a.size_bytes)}</dd>
      </div>
      <div>
        <dt>Release notes</dt>
        <dd>{a.release_notes?.trim() ? a.release_notes : "—"}</dd>
      </div>
    </dl>
  );
}

export type OtaCampaignNewWizardProps = {
  onSuccess: (campaignId: string) => void;
  onCancel: () => void;
  initialSiteId?: string | null;
  contextDeviceId?: string | null;
  contextDeviceName?: string | null;
  contextSiteName?: string | null;
};

export function OtaCampaignNewWizard({
  onSuccess,
  onCancel,
  initialSiteId,
  contextDeviceId = null,
  contextDeviceName = null,
  contextSiteName = null,
}: OtaCampaignNewWizardProps) {
  const { pushMessage } = useShellMessage();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [sitePick, setSitePick] = useState("");
  const sitePerm = useSitePermissionKeys(sitePick || null);
  const [fw, setFw] = useState("");
  const [strategy, setStrategy] = useState("");
  const [devices, setDevices] = useState<DeviceRead[]>([]);
  const [devSearch, setDevSearch] = useState("");
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const [artifactMode, setArtifactMode] = useState<"pick" | "create">("pick");
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [artifactMeta, setArtifactMeta] = useState<FirmwareArtifactRead | null>(null);
  const [artifacts, setArtifacts] = useState<FirmwareArtifactRead[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);

  const [newUrl, setNewUrl] = useState("");
  const [newSha256, setNewSha256] = useState("");
  const [newSignature, setNewSignature] = useState("");
  const [newSigAlgo, setNewSigAlgo] = useState("");
  const [newSizeStr, setNewSizeStr] = useState("");
  const [newReleaseNotes, setNewReleaseNotes] = useState("");

  const [simDeviceId, setSimDeviceId] = useState("");
  const [simJob, setSimJob] = useState<SimulationJobRead | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [simErr, setSimErr] = useState<string | null>(null);

  const [campaignSnapshot, setCampaignSnapshot] = useState<OtaCampaignRead | null>(null);

  const launchedFromDeviceRow = Boolean(contextDeviceId && contextDeviceName);

  const canCreate = Boolean(sitePick && !sitePerm.loading && sitePerm.has("ota.create"));
  const canReadArtifacts = Boolean(sitePick && !sitePerm.loading && sitePerm.has("ota.read"));
  const canSimulate = Boolean(sitePick && !sitePerm.loading && sitePerm.has("simulation.run"));
  const canSubmit = Boolean(sitePick && !sitePerm.loading && sitePerm.has("ota.create"));
  const canApprove = Boolean(sitePick && !sitePerm.loading && sitePerm.has("ota.approve"));
  const canLaunch = Boolean(sitePick && !sitePerm.loading && sitePerm.has("ota.launch"));

  useEffect(() => {
    void apiFetch<SiteRow[]>("/administration/sites")
      .then((d) => setSites(d ?? []))
      .catch(() => setSites([]));
  }, []);

  useEffect(() => {
    if (initialSiteId) setSitePick(initialSiteId);
    else if (sites.length === 1) setSitePick(sites[0].id);
  }, [initialSiteId, sites]);

  useEffect(() => {
    setArtifactId(null);
    setArtifactMeta(null);
    setArtifacts([]);
  }, [sitePick]);

  useEffect(() => {
    if (!sitePick || step !== 0 || artifactMode !== "pick" || !canReadArtifacts) {
      return;
    }
    let cancelled = false;
    setArtifactsLoading(true);
    void listOtaArtifacts(sitePick)
      .then((res) => {
        if (!cancelled) setArtifacts(res?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setArtifacts([]);
      })
      .finally(() => {
        if (!cancelled) setArtifactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sitePick, step, artifactMode, canReadArtifacts]);

  useEffect(() => {
    if (!sitePick || step < 1) return;
    let cancelled = false;
    void listDevices({ site_id: sitePick })
      .then((d) => {
        if (!cancelled) setDevices(d ?? []);
      })
      .catch(() => {
        if (!cancelled) setDevices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sitePick, step]);

  useEffect(() => {
    if (step !== 1 || !contextDeviceId) return;
    if (!devices.some((d) => d.id === contextDeviceId)) return;
    setPick((p) => ({ ...p, [contextDeviceId]: true }));
  }, [step, contextDeviceId, devices]);

  const selectedIds = useMemo(
    () =>
      Object.entries(pick)
        .filter(([, v]) => v)
        .map(([k]) => k),
    [pick],
  );

  const filteredDevices = useMemo(() => {
    const q = devSearch.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) => d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q));
  }, [devices, devSearch]);

  const goNext = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const onRunSimulation = useCallback(async () => {
    if (!simDeviceId || !canSimulate) return;
    setSimBusy(true);
    setSimErr(null);
    try {
      const job = await runReplaySimulation({
        device_id: simDeviceId,
        scope_hours: 168,
        sample_size: 200,
      });
      setSimJob(job);
      pushMessage("success", "Replay simulation completed.");
    } catch (e) {
      setSimErr(isApiHttpError(e) ? e.message : "Simulation failed");
    } finally {
      setSimBusy(false);
    }
  }, [simDeviceId, canSimulate, pushMessage]);

  const ensureArtifactForNext = async (): Promise<boolean> => {
    if (!sitePick || !name.trim()) {
      pushMessage("error", "Campaign name and site are required.");
      return false;
    }
    if (!canCreate) {
      pushMessage("error", "Missing ota.create for this site.");
      return false;
    }
    if (artifactMode === "create") {
      if (artifactId && artifactMeta) {
        return true;
      }
    } else if (artifactMode === "pick") {
      if (!artifactId || !artifactMeta) {
        pushMessage("error", "Select a firmware artifact from the list.");
        return false;
      }
      return true;
    }
    const url = newUrl.trim();
    const sha = newSha256.trim();
    if (!url || !sha) {
      pushMessage("error", "Artifact URL and SHA-256 are required to register a new artifact.");
      return false;
    }
    let sizeBytes: number | null = null;
    if (newSizeStr.trim()) {
      const n = Number.parseInt(newSizeStr.trim(), 10);
      if (Number.isNaN(n) || n < 0) {
        pushMessage("error", "Size (bytes) must be a non-negative integer.");
        return false;
      }
      sizeBytes = n;
    }
    setBusy(true);
    try {
      const created = await createOtaArtifact({
        site_id: sitePick,
        artifact_url: url,
        sha256: sha,
        signature: newSignature.trim() || null,
        signature_algorithm: newSigAlgo.trim() || null,
        size_bytes: sizeBytes,
        release_notes: newReleaseNotes.trim() || null,
      });
      if (!created?.id) {
        pushMessage("error", "Artifact create returned no id.");
        return false;
      }
      setArtifactId(created.id);
      setArtifactMeta(created);
      pushMessage("success", "Firmware artifact registered.");
      return true;
    } catch (e) {
      pushMessage("error", isApiHttpError(e) ? e.message : "Failed to create artifact");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onArtifactStepNext = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !sitePick) {
      pushMessage("error", "Campaign name and site are required.");
      return;
    }
    if (!canCreate) {
      pushMessage("error", "Missing ota.create for this site.");
      return;
    }
    if (artifactMode === "create") {
      const ok = await ensureArtifactForNext();
      if (!ok) return;
    } else if (!artifactId || !artifactMeta) {
      pushMessage("error", "Select a firmware artifact.");
      return;
    }
    goNext();
  };

  const onCreateDraft = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !sitePick || !artifactId) {
      pushMessage("error", "Name, site, and artifact are required.");
      return;
    }
    if (!canCreate) {
      pushMessage("error", "Missing ota.create for this site.");
      return;
    }
    setBusy(true);
    try {
      const c = await createOtaCampaign({
        name: name.trim(),
        site_id: sitePick,
        artifact_id: artifactId,
        target_firmware_version: fw.trim() || null,
        rollout_strategy: strategy.trim() || null,
      });
      if (!c?.id) {
        pushMessage("error", "Create returned no id.");
        return;
      }
      if (selectedIds.length > 0) {
        await addOtaCampaignTargets(c.id, selectedIds);
      }
      setCampaignSnapshot(c);
      pushMessage("success", "Draft campaign created.");
      setStep(3);
    } catch (err) {
      pushMessage("error", isApiHttpError(err) ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const refreshCampaign = async (id: string) => {
    const detail = await getOtaCampaign(id);
    if (detail) setCampaignSnapshot(detail);
  };

  const onSubmitForApproval = async () => {
    if (!campaignSnapshot) return;
    setBusy(true);
    try {
      const c = await submitOtaCampaign(campaignSnapshot.id);
      if (c) setCampaignSnapshot(c);
      pushMessage("success", "Submitted for approval.");
    } catch (e) {
      pushMessage("error", isApiHttpError(e) ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  const onApprove = async () => {
    if (!campaignSnapshot) return;
    setBusy(true);
    try {
      const c = await approveOtaCampaign(campaignSnapshot.id);
      if (c) setCampaignSnapshot(c);
      pushMessage("success", "Campaign approved.");
    } catch (e) {
      pushMessage("error", isApiHttpError(e) ? e.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  };

  const onLaunch = async () => {
    if (!campaignSnapshot) return;
    setBusy(true);
    try {
      const c = await launchOtaCampaign(campaignSnapshot.id);
      if (c) setCampaignSnapshot(c);
      pushMessage("success", "Campaign launched.");
    } catch (e) {
      pushMessage("error", isApiHttpError(e) ? e.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  };

  const pillDisabled = (i: number) => {
    if (campaignSnapshot) {
      if (i < 2) return true;
      return i > step;
    }
    return i > step;
  };

  const onPillClick = (i: number) => {
    if (pillDisabled(i)) return;
    setStep(i);
  };

  return (
    <div className="ota-campaigns-page">
      <nav className="ota-wizard__stepper" aria-label="Campaign wizard steps">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`ota-wizard__pill${i === step ? " ota-wizard__pill--active" : ""}${i < step ? " ota-wizard__pill--done" : ""}`}
            onClick={() => onPillClick(i)}
            disabled={pillDisabled(i)}
          >
            <span className="ota-wizard__pill__n">
              {i < step ? <Check size={14} strokeWidth={ICON_STROKE_WIDTH} aria-hidden /> : i + 1}
            </span>
            <span className="ota-wizard__pill__t">{label}</span>
          </button>
        ))}
      </nav>

      {step === 0 ? (
        <form className="ota-wizard__panel" onSubmit={(e) => void onArtifactStepNext(e)}>
          {launchedFromDeviceRow ? (
            <div className="ota-wizard__context-banner" aria-live="polite">
              <div className="ota-wizard__context-banner-label">Device & site</div>
              <div className="ota-wizard__context-banner-value">
                <span className="ota-wizard__context-device">{contextDeviceName}</span>
                <span className="ota-wizard__context-sep" aria-hidden>
                  {" "}
                  ·{" "}
                </span>
                <span className="ota-wizard__context-site">{contextSiteName ?? "—"}</span>
              </div>
            </div>
          ) : null}
          <h2 className="ota-wizard__panel-title">Firmware artifact & plan</h2>
          <p className="ota-campaigns-page__sub">
            The campaign references a single <strong>firmware artifact</strong> (URL, checksum, optional signature). Choose an
            existing artifact for this site or register a new one, then set the rollout name and target firmware label.
          </p>
          <label className="ota-campaigns-page__field">
            Campaign name *
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={255} />
          </label>
          {launchedFromDeviceRow ? null : (
            <label className="ota-campaigns-page__field">
              Site *
              <select className="app-native-select" value={sitePick} onChange={(e) => setSitePick(e.target.value)} required>
                <option value="">Select site…</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="ota-campaigns-page__field">
            Target firmware version (label)
            <input value={fw} onChange={(e) => setFw(e.target.value)} maxLength={128} placeholder="e.g. 2.4.1 — shown on targets" />
          </label>
          <label className="ota-campaigns-page__field">
            Rollout strategy (notes)
            <textarea
              className="ota-campaigns-page__textarea app-native-multiline"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              rows={3}
              placeholder="Staged groups, maintenance window, rollback criteria…"
            />
          </label>

          <fieldset className="ota-wizard__artifact-fieldset">
            <legend className="ota-wizard__artifact-legend">Firmware artifact *</legend>
            <div className="ota-wizard__artifact-modes" role="radiogroup" aria-label="Artifact source">
              <label className="ota-wizard__artifact-mode">
                <input
                  type="radio"
                  name="artifactMode"
                  checked={artifactMode === "pick"}
                  onChange={() => {
                    setArtifactMode("pick");
                    setArtifactId(null);
                    setArtifactMeta(null);
                  }}
                />
                Pick existing
              </label>
              <label className="ota-wizard__artifact-mode">
                <input
                  type="radio"
                  name="artifactMode"
                  checked={artifactMode === "create"}
                  onChange={() => {
                    setArtifactMode("create");
                    setArtifactId(null);
                    setArtifactMeta(null);
                  }}
                />
                Create new
              </label>
            </div>

            {artifactMode === "pick" ? (
              <div className="ota-wizard__artifact-pick">
                {!canReadArtifacts ? (
                  <p className="ota-campaigns-page__sub" role="status">
                    You need <code>ota.read</code> for this site to list artifacts.
                  </p>
                ) : !sitePick ? (
                  <p className="ota-campaigns-page__sub">Select a site to load artifacts.</p>
                ) : artifactsLoading ? (
                  <p className="ota-campaigns-page__sub">Loading artifacts…</p>
                ) : artifacts.length === 0 ? (
                  <p className="ota-campaigns-page__sub">No artifacts for this site yet. Switch to “Create new” or register one first.</p>
                ) : (
                  <label className="ota-campaigns-page__field">
                    Artifact
                    <select
                      className="app-native-select"
                      value={artifactId ?? ""}
                      onChange={(e) => {
                        const id = e.target.value;
                        const row = artifacts.find((x) => x.id === id);
                        setArtifactId(id || null);
                        setArtifactMeta(row ?? null);
                      }}
                    >
                      <option value="">Select artifact…</option>
                      {artifacts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.sha256.slice(0, 12)}… · {a.artifact_url.slice(0, 40)}
                          {a.artifact_url.length > 40 ? "…" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {artifactMeta ? <ArtifactPreview a={artifactMeta} /> : null}
              </div>
            ) : (
              <div className="ota-wizard__artifact-create">
                {!canCreate ? (
                  <p className="ota-campaigns-page__sub" role="status">
                    You need <code>ota.create</code> to register a new artifact.
                  </p>
                ) : null}
                <label className="ota-campaigns-page__field">
                  Artifact URL *
                  <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://…" maxLength={8000} />
                </label>
                <label className="ota-campaigns-page__field">
                  SHA-256 *
                  <input className="ota-wizard__mono" value={newSha256} onChange={(e) => setNewSha256(e.target.value)} placeholder="hex digest" maxLength={128} />
                </label>
                <label className="ota-campaigns-page__field">
                  Signature (optional)
                  <textarea className="ota-campaigns-page__textarea" value={newSignature} onChange={(e) => setNewSignature(e.target.value)} rows={2} placeholder="Base64 or PEM…" />
                </label>
                <label className="ota-campaigns-page__field">
                  Signature algorithm (optional)
                  <input value={newSigAlgo} onChange={(e) => setNewSigAlgo(e.target.value)} placeholder="e.g. ed25519" maxLength={64} />
                </label>
                <label className="ota-campaigns-page__field">
                  Size (bytes, optional)
                  <input value={newSizeStr} onChange={(e) => setNewSizeStr(e.target.value)} inputMode="numeric" placeholder="e.g. 1048576" />
                </label>
                <label className="ota-campaigns-page__field">
                  Release notes (optional)
                  <textarea className="ota-campaigns-page__textarea" value={newReleaseNotes} onChange={(e) => setNewReleaseNotes(e.target.value)} rows={3} />
                </label>
                {artifactMeta && artifactMode === "create" && artifactId ? <ArtifactPreview a={artifactMeta} /> : null}
              </div>
            )}
          </fieldset>

          <div className="ota-campaign-detail__actions">
            <AarButton type="submit" variant="primary" disabled={busy || !name.trim() || !sitePick || !canCreate}>
              Next: Targets <ChevronRight size={16} aria-hidden />
            </AarButton>
            <AarButton type="button" variant="outline" onClick={onCancel}>
              Cancel
            </AarButton>
          </div>
        </form>
      ) : null}

      {step === 1 ? (
        <div className="ota-wizard__panel">
          <h2 className="ota-wizard__panel-title">Targets</h2>
          <p className="ota-campaigns-page__sub">
            Select devices in <strong>{sites.find((s) => s.id === sitePick)?.name ?? "site"}</strong>. Targets are fixed per
            device when you create the draft (no dynamic groups).
          </p>
          {!canCreate ? (
            <p className="ota-campaigns-page__sub" role="status">
              You need <code>ota.create</code> for this site to add targets.
            </p>
          ) : null}
          <label className="ota-campaigns-page__field">
            Filter devices
            <input value={devSearch} onChange={(e) => setDevSearch(e.target.value)} placeholder="Search by name or id" />
          </label>
          <div className="ota-wizard__device-grid">
            {filteredDevices.map((d) => (
              <label key={d.id} className="ota-wizard__device-row">
                <input type="checkbox" checked={Boolean(pick[d.id])} onChange={(e) => setPick((p) => ({ ...p, [d.id]: e.target.checked }))} />
                <span>{d.name}</span>
                <span className="dash-widget__muted">{d.id.slice(0, 8)}…</span>
              </label>
            ))}
          </div>
          {filteredDevices.length === 0 ? <p className="ota-campaigns-page__sub">No devices in this site (or still loading).</p> : null}
          <p className="ota-campaigns-page__sub">
            <strong>{selectedIds.length}</strong> device(s) selected.
          </p>
          <div className="ota-campaign-detail__actions">
            <AarButton type="button" variant="outline" onClick={goBack}>
              Back
            </AarButton>
            <AarButton type="button" variant="primary" onClick={goNext}>
              Next: Review <ChevronRight size={16} aria-hidden />
            </AarButton>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <form className="ota-wizard__panel" onSubmit={(e) => void onCreateDraft(e)}>
          <h2 className="ota-wizard__panel-title">Review</h2>
          {campaignSnapshot ? (
            <p className="ota-campaigns-page__sub" role="status">
              Draft <strong>{campaignSnapshot.name}</strong> already created. Continue to <strong>Submit / Launch</strong> to
              move it through approval, or open the campaign page.
            </p>
          ) : (
            <p className="ota-campaigns-page__sub">Confirm the artifact, plan, and targets before creating the draft.</p>
          )}
          <ul className="ota-wizard__review">
            <li>
              <strong>Name:</strong> {name.trim() || "—"}
            </li>
            <li>
              <strong>Site:</strong> {sites.find((s) => s.id === sitePick)?.name ?? sitePick}
            </li>
            <li>
              <strong>Artifact:</strong> {artifactMeta ? `${artifactMeta.sha256.slice(0, 16)}…` : artifactId ? artifactId.slice(0, 8) : "—"}
            </li>
            <li>
              <strong>Target firmware (label):</strong> {fw.trim() || "—"}
            </li>
            <li>
              <strong>Targets:</strong> {selectedIds.length} device(s)
            </li>
            <li>
              <strong>Replay (optional):</strong> {simJob ? `${simJob.status} (${simJob.records_tested} samples)` : "Not run"}
            </li>
          </ul>
          {artifactMeta ? <ArtifactPreview a={artifactMeta} /> : null}

          <h3 className="ota-campaign-detail__section-title" style={{ marginTop: "1.25rem" }}>
            Optional replay
          </h3>
          <p className="ota-campaigns-page__sub">
            Pipeline replay lives primarily under Device → Versions; you can still run a quick structural replay here before
            creating the draft.
          </p>
          {!canSimulate ? (
            <p className="ota-campaigns-page__sub" role="status">
              <code>simulation.run</code> is required to run replay from the wizard.
            </p>
          ) : null}
          <label className="ota-campaigns-page__field">
            Device for replay
            <select className="app-native-select" value={simDeviceId} onChange={(e) => setSimDeviceId(e.target.value)}>
              <option value="">Select…</option>
              {(selectedIds.length ? devices.filter((d) => selectedIds.includes(d.id)) : devices).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {simErr ? (
            <p className="ota-campaigns-page__sub" style={{ color: "var(--color-danger, #b91c1c)" }}>
              {simErr}
            </p>
          ) : null}
          <div className="ota-campaign-detail__actions">
            <AarButton type="button" variant="outline" onClick={() => void onRunSimulation()} disabled={!simDeviceId || !canSimulate || simBusy}>
              {simBusy ? "Running…" : "Run replay"}
            </AarButton>
          </div>
          {simJob ? (
            <div className="ota-wizard__sim-summary">
              <p>
                <strong>Status:</strong> {simJob.status} · tested {simJob.records_tested}, pass {simJob.records_passed}, fail{" "}
                {simJob.records_failed}
              </p>
              {typeof simJob.result_json?.recommendation === "string" ? (
                <p className="ota-campaigns-page__sub">{simJob.result_json.recommendation as string}</p>
              ) : null}
            </div>
          ) : null}

          {!canCreate ? (
            <p className="ota-campaigns-page__sub" role="status">
              You need <code>ota.create</code> for this site to create the campaign.
            </p>
          ) : null}
          <div className="ota-campaign-detail__actions">
            <AarButton type="button" variant="outline" onClick={goBack}>
              Back
            </AarButton>
            {campaignSnapshot ? (
              <AarButton type="button" variant="primary" onClick={() => setStep(3)}>
                Continue to Submit / Launch <ChevronRight size={16} aria-hidden />
              </AarButton>
            ) : (
              <AarButton type="submit" variant="primary" disabled={busy || !canCreate || !artifactId}>
                {busy ? "Creating…" : "Create draft campaign"}
              </AarButton>
            )}
            <AarButton type="button" variant="outline" onClick={onCancel}>
              Cancel
            </AarButton>
          </div>
        </form>
      ) : null}

      {step === 3 && campaignSnapshot ? (
        <div className="ota-wizard__panel">
          <h2 className="ota-wizard__panel-title">Submit / Launch</h2>
          <p className="ota-campaigns-page__sub">
            Governed control plane: move the campaign through approval and launch when your process allows. Executor work uses{" "}
            <code>ota.executor.*</code> after launch.
          </p>
          <p className="ota-campaigns-page__sub">
            <strong>Executor auth (v1):</strong> assign the <code>ota_executor</code> tenant role to a dedicated user and use
            JWT. Add static tokens or mTLS when executors run outside your trusted environment or need rotation.
          </p>
          <ul className="ota-wizard__review">
            <li>
              <strong>Campaign:</strong> {campaignSnapshot.name}
            </li>
            <li>
              <strong>Status:</strong> {campaignSnapshot.status} · <strong>Approval:</strong> {campaignSnapshot.approval_status}
            </li>
          </ul>
          <div className="ota-campaign-detail__actions">
            {campaignSnapshot.status === "draft" && canSubmit ? (
              <AarButton type="button" variant="primary" disabled={busy} onClick={() => void onSubmitForApproval()}>
                Submit for approval
              </AarButton>
            ) : null}
            {campaignSnapshot.status === "pending_approval" && canApprove ? (
              <AarButton type="button" variant="primary" disabled={busy} onClick={() => void onApprove()}>
                Approve
              </AarButton>
            ) : null}
            {campaignSnapshot.status === "approved" && canLaunch ? (
              <AarButton type="button" variant="primary" disabled={busy} onClick={() => void onLaunch()}>
                Launch campaign
              </AarButton>
            ) : null}
            {["running", "paused", "completed", "failed", "cancelled"].includes(campaignSnapshot.status) ? (
              <p className="ota-campaigns-page__sub" role="status">
                Campaign is <strong>{campaignSnapshot.status}</strong>. Open the campaign page for pause, resume, events, and
                rollout details.
              </p>
            ) : null}
            <AarButton type="button" variant="outline" disabled={busy} onClick={() => void refreshCampaign(campaignSnapshot.id)}>
              Refresh status
            </AarButton>
            <AarButton type="button" variant="outline" onClick={() => onSuccess(campaignSnapshot.id)}>
              Open campaign page
            </AarButton>
            <AarButton type="button" variant="outline" onClick={onCancel}>
              Close
            </AarButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
