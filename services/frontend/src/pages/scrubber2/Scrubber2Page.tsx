import "./scrubber2.css";
import "../device-register-page.css";
import "@/components/app/confirm-action-modal.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, isApiHttpError } from "@/api/client";
import { createEndpoint, listEndpoints, type EndpointRead } from "@/api/endpoints";
import { getDevice, listDevices } from "@/api/devices";
import { normalizeProtocol } from "@/lib/deviceEndpointConfig";
import { isValidCustomEndpointName, protocolLabelForTable } from "@/lib/ingestEndpointFormOptions";
import { useConfirmAction } from "@/contexts/ConfirmActionContext";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";
import {
  buildFieldMetaList,
  scrubberPreviewPayloadForFieldPickers,
  scrubber2ShapedPayloadForEarlyPickers,
} from "@/lib/scrubber2Fields";
import {
  deviceLabelPathsFromScrubberSemantics,
  primaryKeyPathsFromScrubberSemantics,
} from "@/lib/scrubber2IdentityFromSemantics";
import { buildScrubberStudioMappingForPreview, buildStudioDraftFromV2, bumpSemverLike } from "@/lib/scrubber2ToStudioDraft";
import { FieldExplorerPanel } from "@/pages/scrubber2/FieldExplorerPanel";
import { LivePreviewPanel, type ScrubberPreviewBlock } from "@/pages/scrubber2/LivePreviewPanel";
import { Scrubber2Header } from "@/pages/scrubber2/Scrubber2Header";
import { Scrubber2Layout } from "@/pages/scrubber2/Scrubber2Layout";
import { Scrubber2Shell } from "@/pages/scrubber2/Scrubber2Shell";
import { ScrubberRawSelectModal } from "@/pages/scrubber2/ScrubberRawSelectModal";
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

const PUBLISH_PIPELINE_MODAL_TITLE = "Freeze this pipeline?";
const PUBLISH_PIPELINE_MODAL_BODY =
  "Ingestion workers will use this frozen scrubber definition (publishedBody + version) for this device. Future ingested payloads follow this mapping.";
const PUBLISH_PIPELINE_BUTTON_HINT =
  "Freeze this scrubber configuration as the active version used by ingestion workers.";

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
    decodeSeriesSteps: Array.isArray(partial.decodeSeriesSteps)
      ? (partial.decodeSeriesSteps.filter(
          (x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x),
        ) as Record<string, unknown>[])
      : d.decodeSeriesSteps,
  };
}

type ConnectPostFreezePhase = "checking" | "form" | "linked" | "no_endpoint" | "failed";

export function Scrubber2Page() {
  const navigate = useNavigate();
  const { siteId: opsSiteId, setSiteId: setOpsSiteId, refreshToken } = useOpsShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawIdParam = searchParams.get("rawId");
  const deviceIdParam = searchParams.get("deviceId");
  const returnToRaw = searchParams.get("returnTo") ?? "";
  const safeReturnTo = returnToRaw.startsWith("/") ? returnToRaw : "";

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

  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectPhase, setConnectPhase] = useState<ConnectPostFreezePhase>("checking");
  const [connectInnerBusy, setConnectInnerBusy] = useState(false);
  const [connectSubmitBusy, setConnectSubmitBusy] = useState(false);
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [connectFrozenVersion, setConnectFrozenVersion] = useState("");
  const [connectSiteId, setConnectSiteId] = useState("");
  const [connectSiteName, setConnectSiteName] = useState("");
  const [connectDeviceName, setConnectDeviceName] = useState("");
  const [connectProtocolRaw, setConnectProtocolRaw] = useState("mqtt");
  const [connectDeviceEndpointId, setConnectDeviceEndpointId] = useState<string | null>(null);
  const [connectLinkedEndpoint, setConnectLinkedEndpoint] = useState<EndpointRead | null>(null);
  const [connectEndpointName, setConnectEndpointName] = useState("");
  const [rawSampleModalOpen, setRawSampleModalOpen] = useState(false);

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

  const fieldsRaw = useMemo(() => (samplePayload ? buildFieldMetaList(samplePayload) : []), [samplePayload]);

  const shapedPayload = useMemo(
    () =>
      samplePayload
        ? scrubber2ShapedPayloadForEarlyPickers(samplePayload, model.keepFields, model.normalize.flatten)
        : null,
    [samplePayload, model.keepFields, model.normalize.flatten],
  );

  const fieldsEarlyPipeline = useMemo(() => {
    const fromShaped = shapedPayload ? buildFieldMetaList(shapedPayload) : [];
    if (fromShaped.length > 0) return fromShaped;
    if (samplePayload) return buildFieldMetaList(samplePayload);
    return [];
  }, [shapedPayload, samplePayload]);

  const pathSamplePreview = useMemo(() => {
    if (!scrubPreview) return null;
    const raw = scrubPreview.preview?.output_payload;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    // Do not gate on `scrubPreview.error`: KPI/health can still error while `output_payload` is usable for Semantics.
    return scrubberPreviewPayloadForFieldPickers(raw as Record<string, unknown>);
  }, [scrubPreview]);

  const fieldsFromPreview = useMemo(
    () => (pathSamplePreview ? buildFieldMetaList(pathSamplePreview) : null),
    [pathSamplePreview],
  );

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
    let cancelled = false;
    void (async () => {
      setBusy(true);
      try {
        const row = await apiFetch<{ mapping: Record<string, unknown> } | null>(
          `/device-objects?device_id=${encodeURIComponent(deviceId)}`,
        );
        if (cancelled) return;
        const m = row?.mapping;
        const s2 = m?.scrubber2 as { model?: Partial<Scrubber2Model> } | undefined;
        const ss = m?.scrubberStudio as Record<string, unknown> | undefined;
        const studioDraft = ss?.draft as { decodeSeriesSteps?: unknown; objectName?: unknown } | undefined;
        if (s2?.model) {
          let merged = hydrateV2Model(s2.model);
          const fromModel = Array.isArray(merged.decodeSeriesSteps) && merged.decodeSeriesSteps.length > 0;
          const fromDraft =
            Array.isArray(studioDraft?.decodeSeriesSteps) && studioDraft.decodeSeriesSteps.length > 0
              ? (studioDraft.decodeSeriesSteps.filter(
                  (x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x),
                ) as Record<string, unknown>[])
              : [];
          if (!fromModel && fromDraft.length) merged = { ...merged, decodeSeriesSteps: [...fromDraft] };
          setModel(merged);
        }
        if (ss && typeof ss === "object") {
          if (typeof ss.version === "string" && ss.version) setMappingVersion(ss.version);
          const pb = ss.publishedBody;
          const dr = ss.draft;
          const fromPb =
            pb && typeof pb === "object" && pb !== null && typeof (pb as { objectName?: unknown }).objectName === "string"
              ? String((pb as { objectName: string }).objectName).trim()
              : "";
          const fromDr =
            dr && typeof dr === "object" && dr !== null && typeof (dr as { objectName?: unknown }).objectName === "string"
              ? String((dr as { objectName: string }).objectName).trim()
              : "";
          if (ss.published && fromPb) setObjectName(fromPb);
          else if (fromDr) setObjectName(fromDr);
          else if (fromPb) setObjectName(fromPb);
        }
      } catch {
        /* no row */
      } finally {
        setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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
      setOk("Saved (scrubberStudio + scrubber2).");
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
    navigate(safeReturnTo || "/scrubber/v2/pipelines");
  }, [runScrubberPreview, saveDraft, navigate, safeReturnTo]);

  const navigateAfterOptionalConnect = useCallback(() => {
    navigate(safeReturnTo || "/scrubber/v2/pipelines");
  }, [navigate, safeReturnTo]);

  const dismissConnectModal = useCallback(() => {
    setConnectModalOpen(false);
    setConnectErr(null);
    navigateAfterOptionalConnect();
  }, [navigateAfterOptionalConnect]);

  const loadConnectModalState = useCallback(
    async (frozenVersion: string) => {
      setConnectFrozenVersion(frozenVersion);
      setConnectPhase("checking");
      setConnectErr(null);
      setConnectLinkedEndpoint(null);
      setConnectSiteId("");
      setConnectSiteName("");
      setConnectDeviceName("");
      setConnectProtocolRaw("mqtt");
      setConnectDeviceEndpointId(null);
      setConnectInnerBusy(true);
      try {
        const [dev, siteRows] = await Promise.all([
          getDevice(deviceId),
          apiFetch<Array<{ id: string; name: string }>>("/administration/sites"),
        ]);
        if (!dev) {
          setConnectErr("Device not found.");
          setConnectPhase("failed");
          return;
        }
        const siteLabel = (siteRows ?? []).find((s) => s.id === dev.site_id)?.name?.trim() ?? "";
        setConnectSiteId(dev.site_id);
        setConnectSiteName(siteLabel);
        setConnectDeviceName(dev.name);
        const proto = dev.endpoint?.protocol ?? "mqtt";
        setConnectProtocolRaw(proto);
        const depId = dev.endpoint?.id ?? null;
        setConnectDeviceEndpointId(depId);
        if (!depId) {
          setConnectPhase("no_endpoint");
          const sug = `${dev.name} platform`.trim();
          setConnectEndpointName(isValidCustomEndpointName(sug) ? sug : "Platform stream");
          return;
        }
        const epList = await listEndpoints({ site_id: dev.site_id });
        const items = epList?.items ?? [];
        const linked = items.find((e) => e.device_endpoint_id === depId) ?? null;
        if (linked) {
          setConnectLinkedEndpoint(linked);
          setConnectPhase("linked");
        } else {
          const sug = `${dev.name} platform`.trim();
          setConnectEndpointName(isValidCustomEndpointName(sug) ? sug : "Platform stream");
          setConnectPhase("form");
        }
      } catch (e) {
        setConnectErr(
          isApiHttpError(e) ? e.message : e instanceof Error ? e.message : "Could not load device or endpoints.",
        );
        setConnectPhase("failed");
      } finally {
        setConnectInnerBusy(false);
      }
    },
    [deviceId],
  );

  const openConnectPostFreeze = useCallback(
    (frozenVersion: string) => {
      setConnectModalOpen(true);
      setConnectPhase("checking");
      void loadConnectModalState(frozenVersion);
    },
    [loadConnectModalState],
  );

  const submitConnectCreate = useCallback(async () => {
    const name = connectEndpointName.trim();
    if (!isValidCustomEndpointName(name)) {
      setConnectErr("Use 1–255 characters: letters, numbers, spaces, and . _ - (must start with a letter or number).");
      return;
    }
    if (!connectDeviceEndpointId || !connectSiteId) return;
    setConnectSubmitBusy(true);
    setConnectErr(null);
    try {
      const pkPaths = primaryKeyPathsFromScrubberSemantics(model);
      const labelPaths = deviceLabelPathsFromScrubberSemantics(model);
      await createEndpoint({
        site_id: connectSiteId,
        endpoint_name: name,
        protocol: normalizeProtocol(connectProtocolRaw),
        device_endpoint_id: connectDeviceEndpointId,
        enabled: true,
        primary_device_key_fields: pkPaths.length ? pkPaths : undefined,
        device_label_fields: labelPaths.length ? labelPaths : undefined,
      });
      setConnectModalOpen(false);
      setOk(
        pkPaths.length
          ? "Platform ingest linked. Identity paths from Scrubber semantics are applied automatically when validation succeeds (using your frozen pipeline and archived raw if needed)."
          : "Platform ingest linked. Tag fields as Identity in Scrubber semantics, freeze the pipeline, then link again — or set primary paths on Endpoints.",
      );
      navigateAfterOptionalConnect();
    } catch (e) {
      setConnectErr(isApiHttpError(e) ? e.message : e instanceof Error ? e.message : "Create failed.");
    } finally {
      setConnectSubmitBusy(false);
    }
  }, [
    connectEndpointName,
    connectDeviceEndpointId,
    connectSiteId,
    connectProtocolRaw,
    model,
    navigateAfterOptionalConnect,
  ]);

  useEffect(() => {
    if (!connectModalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismissConnectModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connectModalOpen, dismissConnectModal]);

  /** Canonical live publish: legacy studio draft + version bump + publishedBody; keeps scrubber2.model in sync. */
  const runPublishPipeline = useCallback(async () => {
    if (!deviceId) {
      setErr("Select a device to freeze the pipeline for.");
      return;
    }
    if (!samplePayload) {
      setErr("Load raw preview before freezing.");
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
      setOk(`Pipeline frozen at version ${nextV}.`);
      openConnectPostFreeze(nextV);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Freeze failed");
    } finally {
      setBusy(false);
    }
  }, [deviceId, samplePayload, model, objectName, mappingVersion, openConnectPostFreeze]);

  const openPublishConfirm = useCallback(async () => {
    if (!deviceId) {
      setErr("Select a device to freeze the pipeline for.");
      return;
    }
    if (!samplePayload) {
      setErr("Load raw preview before freezing.");
      return;
    }
    setErr(null);
    await confirm({
      title: PUBLISH_PIPELINE_MODAL_TITLE,
      message: PUBLISH_PIPELINE_MODAL_BODY,
      confirmLabel: "Freeze",
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
      selectAll: () => setModel((m) => ({ ...m, keepFields: fieldsRaw.map((f) => f.path) })),
      clearAll: () => setModel((m) => ({ ...m, keepFields: [] })),
      setFieldDescription: (path, v) =>
        setModel((m) => ({
          ...m,
          fieldDescriptions: { ...m.fieldDescriptions, [path]: v },
        })),
    }),
    [fieldSearch, keepSet, fieldsRaw],
  );

  return (
    <>
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
              Save
            </button>
            <button
              type="button"
              className="dm-btn dm-btn--primary"
              disabled={busy}
              title={PUBLISH_PIPELINE_BUTTON_HINT}
              onClick={openPublishConfirm}
            >
              Freeze
            </button>
            <button
              type="button"
              className="scrubber2-btn scrubber2-btn--ghost"
              style={{ marginLeft: "0.35rem" }}
              disabled={!deviceId}
              title={!deviceId ? "Select a device first" : undefined}
              onClick={() => deviceId && setRawSampleModalOpen(true)}
            >
              Raw sample
            </button>
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
            fields={fieldsRaw}
            fieldSearch={fieldSearch}
            onFieldSearchChange={setFieldSearch}
            keepSet={keepSet}
            onToggleField={(path, v) => explorer.toggleKeep(path, v)}
            onSelectAll={explorer.selectAll}
            onClearAll={explorer.clearAll}
            sampledLabel={sampledAt}
          />
        }
        center={
          <Scrubber2StepWorkspace
            activeStep={activeStep}
            onStepChange={setActiveStep}
            model={model}
            setModel={setModel}
            fields={fieldsRaw}
            fieldsEarlyPipeline={fieldsEarlyPipeline}
            fieldsFromPreview={fieldsFromPreview}
            pathSampleEarly={shapedPayload}
            pathSamplePreview={pathSamplePreview}
            samplePayload={samplePayload}
            rawId={rawId}
            onRequestPreview={() => void runScrubberPreview()}
            explorer={explorer}
            onFinish={() => void finishWizard()}
          />
        }
        right={<LivePreviewPanel scrubPreview={scrubPreview} samplePayload={samplePayload} model={model} />}
      />

      {connectModalOpen ? (
        <div
          className="confirm-action-modal__backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !connectSubmitBusy) dismissConnectModal();
          }}
        >
          <div
            className="confirm-action-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-ingest-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="confirm-action-modal__head">
              <h2 id="connect-ingest-title" className="confirm-action-modal__title">
                Connect platform ingest
              </h2>
            </div>
            <div className="confirm-action-modal__body">
              <p style={{ marginTop: 0 }}>
                Optional next step: link a platform stream so dashboards and resolved devices can use this device.
                You can always add or change streams from{" "}
                <Link to="/devices/ingest" onClick={() => setConnectModalOpen(false)}>
                  Endpoints
                </Link>
                .
              </p>
              {connectInnerBusy && connectPhase === "checking" ? (
                <p className="scrubber2-muted" style={{ marginBottom: 0 }}>
                  Checking existing links…
                </p>
              ) : (
                <dl
                  style={{
                    margin: "0.5rem 0 0",
                    display: "grid",
                    gridTemplateColumns: "8.2rem 1fr",
                    gap: "0.35rem 0.6rem",
                    fontSize: "0.8rem",
                  }}
                >
                  <dt className="scrubber2-muted">Site</dt>
                  <dd style={{ margin: 0 }}>{connectSiteName || connectSiteId || "—"}</dd>
                  <dt className="scrubber2-muted">Device</dt>
                  <dd style={{ margin: 0 }}>{connectDeviceName || "—"}</dd>
                  <dt className="scrubber2-muted">Protocol</dt>
                  <dd style={{ margin: 0 }}>{protocolLabelForTable(connectProtocolRaw)}</dd>
                  <dt className="scrubber2-muted">Pipeline frozen</dt>
                  <dd style={{ margin: 0 }}>Version {connectFrozenVersion || "—"}</dd>
                </dl>
              )}

              {connectPhase === "linked" && connectLinkedEndpoint ? (
                <div style={{ marginTop: "0.75rem" }}>
                  <p style={{ margin: "0 0 0.4rem", color: "var(--dm-text, #f4f6f8)", fontWeight: 600 }}>
                    Already connected
                  </p>
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem" }}>
                    Stream <strong>{connectLinkedEndpoint.endpoint_name}</strong> is linked to this device&apos;s
                    connectivity row.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", fontSize: "0.8rem" }}>
                    <Link
                      className="scrubber2-muted"
                      to={`/devices/ingest?identity=${encodeURIComponent(connectLinkedEndpoint.id)}`}
                      onClick={() => setConnectModalOpen(false)}
                    >
                      Identity mapping
                    </Link>
                    <span className="scrubber2-muted" aria-hidden>
                      ·
                    </span>
                    <Link className="scrubber2-muted" to="/devices/ingest" onClick={() => setConnectModalOpen(false)}>
                      Manage streams
                    </Link>
                  </div>
                </div>
              ) : null}

              {connectPhase === "no_endpoint" ? (
                <p style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>
                  This device does not have a saved connectivity profile yet. Save protocol settings on{" "}
                  <Link to={`/devices/manage?device=${encodeURIComponent(deviceId)}`} onClick={() => setConnectModalOpen(false)}>
                    Manage device
                  </Link>{" "}
                  first, then you can create a linked stream from the Endpoints page.
                </p>
              ) : null}

              {connectPhase === "failed" && connectErr ? (
                <p style={{ marginTop: "0.75rem", fontSize: "0.8rem", color: "#fecaca" }}>{connectErr}</p>
              ) : null}

              {connectPhase === "form" ? (
                <div className="confirm-action-modal__require" style={{ paddingTop: "0.5rem" }}>
                  <label className="confirm-action-modal__require-label" htmlFor="connect-endpoint-name">
                    Endpoint name <span style={{ color: "#fecaca" }}>*</span>
                  </label>
                  <input
                    id="connect-endpoint-name"
                    className="confirm-action-modal__input"
                    autoComplete="off"
                    value={connectEndpointName}
                    onChange={(e) => setConnectEndpointName(e.target.value)}
                    disabled={connectSubmitBusy}
                    placeholder="Operator-visible label"
                  />
                  <p className="scrubber2-muted" style={{ margin: "0.45rem 0 0", fontSize: "0.72rem", lineHeight: 1.4 }}>
                    Stream key is assigned automatically. You can change the display name later from{" "}
                    <Link to="/devices/ingest" onClick={() => setConnectModalOpen(false)}>
                      Endpoints
                    </Link>
                    .
                  </p>
                </div>
              ) : null}

              {connectPhase === "form" && connectErr ? (
                <div className="confirm-action-modal__error" style={{ margin: "0.5rem 1rem 0" }}>
                  {connectErr}
                </div>
              ) : null}
            </div>
            <div className="confirm-action-modal__actions">
              {connectPhase === "linked" ? (
                <button type="button" className="dm-btn dm-btn--primary" onClick={() => dismissConnectModal()}>
                  Continue
                </button>
              ) : null}
              {connectPhase === "failed" ? (
                <>
                  <button
                    type="button"
                    className="dm-btn dm-btn--ghost"
                    disabled={connectInnerBusy}
                    onClick={() => dismissConnectModal()}
                  >
                    Skip for now
                  </button>
                  <button
                    type="button"
                    className="dm-btn dm-btn--primary"
                    disabled={connectInnerBusy}
                    onClick={() => void loadConnectModalState(connectFrozenVersion)}
                  >
                    Try again
                  </button>
                </>
              ) : null}
              {connectPhase === "form" || connectPhase === "no_endpoint" ? (
                <>
                  <button
                    type="button"
                    className="dm-btn dm-btn--ghost"
                    disabled={connectSubmitBusy}
                    onClick={() => dismissConnectModal()}
                  >
                    Skip for now
                  </button>
                  {connectPhase === "form" ? (
                    <button
                      type="button"
                      className="dm-btn dm-btn--primary"
                      disabled={
                        connectSubmitBusy ||
                        !isValidCustomEndpointName(connectEndpointName) ||
                        !connectDeviceEndpointId
                      }
                      onClick={() => void submitConnectCreate()}
                    >
                      {connectSubmitBusy ? "Creating…" : "Create & link"}
                    </button>
                  ) : null}
                </>
              ) : null}
              {connectPhase === "checking" ? (
                <button
                  type="button"
                  className="dm-btn dm-btn--ghost"
                  disabled={connectSubmitBusy}
                  onClick={() => dismissConnectModal()}
                >
                  Skip for now
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </Scrubber2Shell>
    <ScrubberRawSelectModal
      open={rawSampleModalOpen && Boolean(deviceId)}
      onClose={() => setRawSampleModalOpen(false)}
      deviceId={deviceId}
      deviceName={devices.find((d) => d.id === deviceId)?.name ?? deviceId}
    />
    </>
  );
}
