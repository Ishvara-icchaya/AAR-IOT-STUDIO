import "./scrubber2.css";
import "../device-register-page.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { listDevices } from "@/api/devices";
import { useConfirmAction } from "@/contexts/ConfirmActionContext";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";
import { buildFieldMetaList } from "@/lib/scrubber2Fields";
import { buildScrubberStudioMappingForPreview, buildStudioDraftFromV2, bumpSemverLike } from "@/lib/scrubber2ToStudioDraft";
import { FieldExplorerPanel } from "@/pages/scrubber2/FieldExplorerPanel";
import { LivePreviewPanel, type ScrubberPreviewBlock } from "@/pages/scrubber2/LivePreviewPanel";
import { Scrubber2Header } from "@/pages/scrubber2/Scrubber2Header";
import { Scrubber2Layout } from "@/pages/scrubber2/Scrubber2Layout";
import { Scrubber2Shell } from "@/pages/scrubber2/Scrubber2Shell";
import { Scrubber2StepWorkspace, type Scrubber2ExplorerBindings } from "@/pages/scrubber2/Scrubber2StepWorkspace";
import { defaultScrubber2Model, type Scrubber2Model } from "@/types/scrubber2Model";

type RawPreviewResp = {
  raw_object_id: string;
  encoding: "utf8" | "base64";
  text: string | null;
  base64: string | null;
  truncated: boolean;
  returned_bytes: number;
};

/** Same contract as Scrubber Studio — newest raw for `device_id` is `items[0]`. */
type RawListHeadResp = {
  items: Array<{ id: string; ingested_at: string | null }>;
  total: number;
};

const PUBLISH_PIPELINE_MODAL_TITLE = "Publish this pipeline?";
const PUBLISH_PIPELINE_MODAL_BODY =
  "Future ingested payloads for this device will use this scrubber definition to generate data objects. This is the same canonical device mapping as classic Scrubber Studio (scrubberStudio publishedBody / version plus your Scrubber 2.0 model).";
const PUBLISH_PIPELINE_BUTTON_HINT =
  "Publish this scrubber configuration as the active version used by ingestion workers.";

function hydrateV2Model(partial: Partial<Scrubber2Model> | null | undefined): Scrubber2Model {
  const d = defaultScrubber2Model();
  if (!partial || typeof partial !== "object") return d;
  return {
    ...d,
    ...partial,
    keepFields: Array.isArray(partial.keepFields) ? partial.keepFields : d.keepFields,
    fieldDescriptions:
      partial.fieldDescriptions && typeof partial.fieldDescriptions === "object" && !Array.isArray(partial.fieldDescriptions)
        ? { ...partial.fieldDescriptions }
        : d.fieldDescriptions,
    normalize: {
      flatten: partial.normalize?.flatten ?? d.normalize.flatten,
      renames: Array.isArray(partial.normalize?.renames) ? partial.normalize!.renames : d.normalize.renames,
      typeCasts:
        partial.normalize?.typeCasts && typeof partial.normalize.typeCasts === "object" && !Array.isArray(partial.normalize.typeCasts)
          ? { ...partial.normalize.typeCasts }
          : d.normalize.typeCasts,
    },
    attributes: Array.isArray(partial.attributes) ? partial.attributes : d.attributes,
    derived: { ...d.derived, ...partial.derived },
    fieldSemantics: Array.isArray(partial.fieldSemantics)
      ? partial.fieldSemantics.map((row) => {
          const r = row as Record<string, unknown>;
          const roles = r.roles;
          return {
            path: typeof r.path === "string" ? r.path : "",
            label: typeof r.label === "string" ? r.label : undefined,
            type: typeof r.type === "string" ? r.type : "string",
            roles: Array.isArray(roles) ? roles.filter((x): x is string => typeof x === "string") : [],
            aiExposed: Boolean(r.aiExposed),
          };
        })
      : d.fieldSemantics,
    health: {
      mode: partial.health?.mode ?? d.health.mode,
      config:
        partial.health?.config && typeof partial.health.config === "object" && !Array.isArray(partial.health.config)
          ? { ...d.health.config, ...partial.health.config }
          : { ...d.health.config },
    },
    kpi: { metrics: Array.isArray(partial.kpi?.metrics) ? partial.kpi!.metrics : d.kpi.metrics },
    location: { ...d.location, ...partial.location },
  };
}

export function Scrubber2Page() {
  const navigate = useNavigate();
  const { siteId: opsSiteId, setSiteId: setOpsSiteId, refreshToken } = useOpsShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawIdParam = searchParams.get("rawId");
  const deviceIdParam = searchParams.get("deviceId");

  const [devices, setDevices] = useState<Array<{ id: string; name: string; site_id: string }>>([]);
  const [deviceId, setDeviceId] = useState(deviceIdParam ?? "");
  const [rawId, setRawId] = useState(rawIdParam ?? "");
  const [mappingVersion, setMappingVersion] = useState("3");
  const [objectName, setObjectName] = useState(`data_object_${Date.now()}`);

  const [model, setModel] = useState<Scrubber2Model>(() => defaultScrubber2Model());
  const [activeStep, setActiveStep] = useState(0);
  const [fieldSearch, setFieldSearch] = useState("");
  const [sampledAt, setSampledAt] = useState<string>("—");

  const [rawPreview, setRawPreview] = useState<RawPreviewResp | null>(null);
  const [scrubPreview, setScrubPreview] = useState<ScrubberPreviewBlock>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const confirm = useConfirmAction();
  useShellFeedback(err, ok);

  const didInitKeep = useRef(false);
  /** Tracks last device we resolved raw for (mirrors classic scrubber device→latest-raw bootstrap). */
  const prevDeviceIdForRawRef = useRef<string | null>(null);
  /** Avoid re-fetch loops when a device has no archived raw yet. */
  const noRawListAttemptedForDeviceRef = useRef<string | null>(null);

  const samplePayload = useMemo(() => {
    if (!rawPreview || rawPreview.encoding !== "utf8" || rawPreview.text == null) return null;
    try {
      return JSON.parse(rawPreview.text) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [rawPreview]);

  const rawJson = useMemo(() => {
    if (!rawPreview || rawPreview.encoding !== "utf8" || rawPreview.text == null) return "";
    try {
      return JSON.stringify(JSON.parse(rawPreview.text) as unknown, null, 2);
    } catch {
      return rawPreview.text;
    }
  }, [rawPreview]);

  const fields = useMemo(() => (samplePayload ? buildFieldMetaList(samplePayload) : []), [samplePayload]);

  const keepSet = useMemo(() => new Set(model.keepFields), [model.keepFields]);

  useEffect(() => {
    void (async () => {
      try {
        const items = await listDevices(opsSiteId?.trim() ? { site_id: opsSiteId.trim() } : undefined);
        setDevices(items.map((d) => ({ id: d.id, name: d.name, site_id: d.site_id })));
      } catch {
        setDevices([]);
      }
    })();
  }, [opsSiteId, refreshToken]);

  useEffect(() => {
    if (!deviceId) return;
    if (devices.length > 0 && !devices.some((d) => d.id === deviceId)) setDeviceId("");
  }, [devices, deviceId]);

  useEffect(() => {
    if (deviceIdParam) setDeviceId(deviceIdParam);
    if (rawIdParam) setRawId(rawIdParam);
  }, [deviceIdParam, rawIdParam]);

  /**
   * Same bootstrap as Scrubber Studio (`ScrubberStudioPage`): when `deviceId` is set and there is no
   * `rawId` (or the device changed), GET `/raw-data-objects?device_id=…&limit=1&offset=0` and use the
   * newest row; sync `deviceId` + `rawId` into the URL with `replace`.
   */
  useEffect(() => {
    let cancelled = false;
    if (!deviceId) {
      prevDeviceIdForRawRef.current = null;
      noRawListAttemptedForDeviceRef.current = null;
      setRawId("");
      setRawPreview(null);
      setScrubPreview(null);
      return;
    }

    const prev = prevDeviceIdForRawRef.current;
    const deviceChanged = prev !== null && prev !== deviceId;
    if (deviceChanged) {
      noRawListAttemptedForDeviceRef.current = null;
    }
    prevDeviceIdForRawRef.current = deviceId;

    if (rawId.trim() && !deviceChanged) {
      return;
    }
    if (!rawId.trim() && noRawListAttemptedForDeviceRef.current === deviceId && !deviceChanged) {
      return;
    }

    void (async () => {
      try {
        const data = await apiFetch<RawListHeadResp>(
          `/raw-data-objects?device_id=${encodeURIComponent(deviceId)}&limit=1&offset=0`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        const first = data?.items?.[0];
        if (first?.id) {
          noRawListAttemptedForDeviceRef.current = null;
          setRawId(first.id);
          setScrubPreview(null);
          setSearchParams(
            (prevParams) => {
              const p = new URLSearchParams(prevParams);
              p.set("deviceId", deviceId);
              p.set("rawId", first.id);
              return p;
            },
            { replace: true },
          );
        } else {
          noRawListAttemptedForDeviceRef.current = deviceId;
          setRawId("");
          setRawPreview(null);
          setScrubPreview(null);
          setOk(null);
          setSearchParams(
            (prevParams) => {
              const p = new URLSearchParams(prevParams);
              p.set("deviceId", deviceId);
              p.delete("rawId");
              return p;
            },
            { replace: true },
          );
          setErr("No archived raw payload for this device yet.");
        }
      } catch {
        if (!cancelled) {
          noRawListAttemptedForDeviceRef.current = deviceId;
          setRawId("");
          setRawPreview(null);
          setScrubPreview(null);
          setErr("Could not list raw archives for this device.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceId, rawId, setSearchParams]);

  useEffect(() => {
    didInitKeep.current = false;
  }, [rawId]);

  useEffect(() => {
    if (!samplePayload || didInitKeep.current) return;
    const all = buildFieldMetaList(samplePayload).map((f) => f.path);
    setModel((m) => (m.keepFields.length > 0 ? m : { ...m, keepFields: all }));
    didInitKeep.current = true;
  }, [samplePayload]);

  const loadRawPreview = useCallback(async () => {
    if (!rawId) {
      setRawPreview(null);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const prev = await apiFetch<RawPreviewResp>(
        `/raw-data-objects/${encodeURIComponent(rawId)}/preview?offset=0&max_bytes=${64 * 1024}`,
        { cache: "no-store" },
      );
      setRawPreview(prev);
      setSampledAt(new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Raw preview failed");
      setRawPreview(null);
    } finally {
      setBusy(false);
    }
  }, [rawId]);

  useEffect(() => {
    void loadRawPreview();
  }, [loadRawPreview]);

  useEffect(() => {
    if (!deviceId) return;
    void (async () => {
      setBusy(true);
      try {
        const row = await apiFetch<{ mapping: Record<string, unknown> } | null>(
          `/device-objects?device_id=${encodeURIComponent(deviceId)}`,
        );
        const m = row?.mapping;
        const s2 = m?.scrubber2 as { model?: Partial<Scrubber2Model> } | undefined;
        if (s2?.model) setModel(hydrateV2Model(s2.model));
        const ss = m?.scrubberStudio as { version?: string } | undefined;
        if (ss && typeof ss.version === "string" && ss.version) setMappingVersion(ss.version);
      } catch {
        /* no row */
      } finally {
        setBusy(false);
      }
    })();
  }, [deviceId]);

  const runScrubberPreview = useCallback(async (): Promise<boolean> => {
    if (!rawId) {
      setErr("Pick a raw sample (rawId) to validate preview.");
      return false;
    }
    if (!samplePayload) {
      setErr("Raw JSON must load before preview.");
      return false;
    }
    setBusy(true);
    setErr(null);
    try {
      const mapping = buildScrubberStudioMappingForPreview(
        model,
        { objectName, version: mappingVersion, parseAs: "auto" },
        samplePayload,
        { enableDerivedWhenCodePresent: true },
      );
      const r = await apiFetch<ScrubberPreviewBlock>(`/scrubber/preview`, {
        method: "POST",
        json: { raw_object_id: rawId, mapping, use_stored_mapping: false },
      });
      setScrubPreview(r);
      setOk("Preview refreshed.");
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Preview failed");
      setScrubPreview(null);
      return false;
    } finally {
      setBusy(false);
    }
  }, [rawId, samplePayload, model, objectName, mappingVersion]);

  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!deviceId) {
      setErr("Select a device to save.");
      return false;
    }
    if (!samplePayload) {
      setErr("Load raw preview before saving so drop-paths can be computed.");
      return false;
    }
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const draft = buildStudioDraftFromV2(model, { objectName, parseAs: "auto" }, samplePayload);
      await apiFetch(`/device-objects?device_id=${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        json: {
          mapping: {
            scrubberStudio: { draft, version: mappingVersion },
            scrubber2: { model },
          },
        },
      });
      setOk("Draft saved (scrubberStudio + scrubber2).");
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setBusy(false);
    }
  }, [deviceId, samplePayload, model, objectName, mappingVersion]);

  const finishWizard = useCallback(async () => {
    const okPreview = await runScrubberPreview();
    if (!okPreview) return;
    const okSave = await saveDraft();
    if (!okSave) return;
    setOk("Saved. Returning to pipelines list…");
    navigate("/scrubber/v2/pipelines");
  }, [runScrubberPreview, saveDraft, navigate]);

  /** Canonical live publish: legacy studio draft + version bump + publishedBody; keeps scrubber2.model in sync. */
  const runPublishPipeline = useCallback(async () => {
    if (!deviceId) {
      setErr("Select a device to publish.");
      return;
    }
    if (!samplePayload) {
      setErr("Load raw preview before publishing.");
      return;
    }
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const draft = buildStudioDraftFromV2(model, { objectName, parseAs: "auto" }, samplePayload);
      const nextV = bumpSemverLike(mappingVersion);
      const publishedBody = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>;
      await apiFetch(`/device-objects?device_id=${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        json: {
          mapping: {
            scrubberStudio: {
              published: true,
              version: nextV,
              draft,
              publishedBody,
            },
            scrubber2: { model },
          },
        },
      });
      setMappingVersion(nextV);
      setOk(`Published version ${nextV}. Ingestion workers use publishedBody as the active scrubber definition.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }, [deviceId, samplePayload, model, objectName, mappingVersion]);

  const openPublishConfirm = useCallback(async () => {
    if (!deviceId) {
      setErr("Select a device to publish.");
      return;
    }
    if (!samplePayload) {
      setErr("Load raw preview before publishing.");
      return;
    }
    setErr(null);
    await confirm({
      title: PUBLISH_PIPELINE_MODAL_TITLE,
      message: PUBLISH_PIPELINE_MODAL_BODY,
      confirmLabel: "Publish",
      variant: "warning",
      onConfirm: runPublishPipeline,
    });
  }, [confirm, deviceId, samplePayload, runPublishPipeline]);

  const explorer: Scrubber2ExplorerBindings = useMemo(
    () => ({
      fieldSearch,
      setFieldSearch,
      keepSet,
      toggleKeep: (path, v) =>
        setModel((m) => {
          const s = new Set(m.keepFields);
          if (v) s.add(path);
          else s.delete(path);
          return { ...m, keepFields: [...s] };
        }),
      selectAll: () => setModel((m) => ({ ...m, keepFields: fields.map((f) => f.path) })),
      clearAll: () => setModel((m) => ({ ...m, keepFields: [] })),
      setFieldDescription: (path, v) =>
        setModel((m) => ({
          ...m,
          fieldDescriptions: { ...m.fieldDescriptions, [path]: v },
        })),
    }),
    [fieldSearch, keepSet, fields],
  );

  return (
    <Scrubber2Shell>
      <nav className="scrubber2-subnav" aria-label="Scrubber pipelines">
        <Link to="/scrubber/v2/pipelines" className="scrubber2-subnav__back">
          <ArrowLeft size={16} strokeWidth={2} aria-hidden />
          Scrubber Pipelines
        </Link>
        <span className="scrubber2-subnav__sep" aria-hidden>
          /
        </span>
        <span className="scrubber2-subnav__current">Create pipeline</span>
        <span className="scrubber2-subnav__hint"> — build or edit the scrubber mapping for a device; return to the list anytime.</span>
      </nav>
      <Scrubber2Header
        devices={devices}
        deviceId={deviceId}
        onDeviceChange={(id) => {
          setDeviceId(id);
          const hit = devices.find((d) => d.id === id);
          if (hit) setOpsSiteId(hit.site_id);
        }}
        actions={
          <>
            <button type="button" className="scrubber2-btn scrubber2-btn--ghost" disabled={busy} onClick={() => void runScrubberPreview()}>
              Validate
            </button>
            <button type="button" className="scrubber2-btn scrubber2-btn--ghost" disabled={busy} onClick={() => void saveDraft()}>
              Save draft
            </button>
            <button
              type="button"
              className="dm-btn dm-btn--primary"
              disabled={busy}
              title={PUBLISH_PIPELINE_BUTTON_HINT}
              onClick={openPublishConfirm}
            >
              Create Pipeline
            </button>
            <Link to="/scrubber/raw-select" className="scrubber2-muted" style={{ fontSize: "0.78rem", marginLeft: "0.35rem" }}>
              Raw sample
            </Link>
          </>
        }
      />

      <p className="scrubber2-publish-hint">{PUBLISH_PIPELINE_BUTTON_HINT}</p>

      <div className="scrubber2-toolbar" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <label className="scrubber2-muted" style={{ fontSize: "0.75rem" }}>
          rawId{" "}
          <input
            className="scrubber2-input"
            style={{ width: 280 }}
            value={rawId}
            onChange={(e) => setRawId(e.target.value.trim())}
            placeholder="UUID from Raw sample page"
          />
        </label>
        <label className="scrubber2-muted" style={{ fontSize: "0.75rem" }}>
          objectName{" "}
          <input className="scrubber2-input" style={{ width: 220 }} value={objectName} onChange={(e) => setObjectName(e.target.value)} />
        </label>
      </div>

      {busy ? (
        <div className="scrubber2-muted" style={{ fontSize: "0.78rem" }}>
          Working…
        </div>
      ) : null}

      <Scrubber2Layout
        left={
          <FieldExplorerPanel
            rawJson={rawJson}
            fields={fields}
            fieldSearch={fieldSearch}
            onFieldSearchChange={setFieldSearch}
            keepSet={keepSet}
            onToggleField={(path, v) => explorer.toggleKeep(path, v)}
            onSelectAll={explorer.selectAll}
            onClearAll={explorer.clearAll}
            sampledLabel={sampledAt}
            onRefreshSample={() => void loadRawPreview()}
          />
        }
        center={
          <Scrubber2StepWorkspace
            activeStep={activeStep}
            onStepChange={setActiveStep}
            model={model}
            setModel={setModel}
            fields={fields}
            samplePayload={samplePayload}
            rawId={rawId}
            onRequestPreview={() => void runScrubberPreview()}
            explorer={explorer}
            onFinish={() => void finishWizard()}
          />
        }
        right={<LivePreviewPanel scrubPreview={scrubPreview} samplePayload={samplePayload} model={model} />}
      />

    </Scrubber2Shell>
  );
}
