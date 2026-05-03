import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import * as dashApi from "@/api/dashboard";

/** Aligns dropdown text with Scrubber Pipelines (pipeline / device) while keeping technical binding visible. */
export function formatEndpointGroupOptionLabel(opt: dashApi.ResolvedDeviceCollectionSourceItem): string {
  const endpointLabel = opt.endpoint_name || opt.endpoint_id.slice(0, 8);
  const count = opt.resolved_device_count;
  const core = `${endpointLabel} · ${opt.object_name} (${count})`;
  const pl = (opt.pipeline_label || "").trim();
  const dn = (opt.device_name || "").trim();
  if (dn) return `${dn} — ${core}`;
  if (pl) return `${pl} — ${core}`;
  return core;
}

export function EndpointGroupPickerField({
  collectionOptions,
  endpointId,
  objectName,
  disabled,
  below,
  onCommit,
}: {
  collectionOptions: dashApi.ResolvedDeviceCollectionSourceItem[];
  endpointId: string;
  objectName: string;
  disabled: boolean;
  below?: ReactNode;
  onCommit: (endpointId: string, objectName: string) => void;
}) {
  const labelId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectValue = `${String(endpointId ?? "")}|${String(objectName ?? "")}`;
  const selectedOpt = useMemo(
    () => collectionOptions.find((o) => `${o.endpoint_id}|${o.object_name}` === selectValue),
    [collectionOptions, selectValue],
  );
  const fullLabel = selectedOpt
    ? formatEndpointGroupOptionLabel(selectedOpt)
    : selectValue && selectValue !== "|"
      ? `${endpointId || "…"} · ${objectName || "…"}`
      : "";

  const displayText = fullLabel || "— Select endpoint + object —";

  function openDialog() {
    if (disabled) return;
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <div className="dash-endpoint-group-field">
      <span className="dash-drawer__label" id={labelId}>
        Endpoint Group
      </span>
      <button
        type="button"
        className="dash-endpoint-group-display dash-drawer__input"
        disabled={disabled}
        onClick={openDialog}
        aria-haspopup="dialog"
        aria-labelledby={labelId}
        title={fullLabel ? `Open full name: ${fullLabel}` : "Choose endpoint group"}
      >
        <span className="dash-endpoint-group-display__text">{displayText}</span>
      </button>
      {below}
      <dialog
        ref={dialogRef}
        className="dash-endpoint-group-dialog"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDialog();
        }}
      >
        <div className="dash-endpoint-group-dialog__panel" onClick={(e) => e.stopPropagation()}>
          <h3 className="dash-endpoint-group-dialog__title">Endpoint group</h3>
          <p className="dash-endpoint-group-dialog__hint">Full name (same as in the dropdown list)</p>
          <div className="dash-endpoint-group-dialog__full" role="region" aria-label="Full endpoint group name">
            {fullLabel ? fullLabel : <span className="dash-widget__muted">No selection yet</span>}
          </div>
          <label className="dash-drawer__label dash-endpoint-group-dialog__select-label dash-endpoint-group-dialog__select-label--compact">
            Change selection
            <div className="dash-endpoint-group-dialog__select-wrap">
              <select
                className="dash-drawer__input dash-endpoint-group-dialog__select"
                value={selectValue}
                disabled={disabled}
                onChange={(e) => {
                  const [eid, oname] = e.target.value.split("|");
                  onCommit(eid || "", oname || "");
                }}
              >
                <option value="">— Select endpoint + object —</option>
                {collectionOptions.map((opt) => {
                  const v = `${opt.endpoint_id}|${opt.object_name}`;
                  return (
                    <option key={v} value={v}>
                      {formatEndpointGroupOptionLabel(opt)}
                    </option>
                  );
                })}
              </select>
            </div>
          </label>
          <div className="dash-endpoint-group-dialog__actions">
            <button type="button" className="dash-btn dash-btn--accent" onClick={closeDialog}>
              Done
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

export function formatLatestDeviceStateRowLabel(x: dashApi.LatestDeviceStateSourceItem): string {
  const name =
    (x.device_name && x.device_name.trim()) ||
    (x.device_label && x.device_label.trim()) ||
    (x.endpoint_name && x.endpoint_name.trim()) ||
    "";
  const tail = `${x.object_name} · ${x.id.slice(0, 8)}…`;
  return name ? `${name} — ${tail}` : tail;
}

export function IndividualDevicePickerField({
  siteId,
  sourceType,
  sourceId,
  disabled,
  onCommit,
}: {
  siteId: string | null;
  sourceType: "latest_device_state" | "result_object";
  sourceId: string;
  disabled: boolean;
  onCommit: (sourceType: "latest_device_state" | "result_object", sourceId: string) => void;
}) {
  const labelId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [ldsItems, setLdsItems] = useState<dashApi.LatestDeviceStateSourceItem[]>([]);
  const [roItems, setRoItems] = useState<dashApi.ResultObjectSourceItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!siteId) {
      setLdsItems([]);
      setRoItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        if (sourceType === "latest_device_state") {
          const r = await dashApi.listDashboardLatestDeviceStateSources(siteId);
          if (cancelled) return;
          setLdsItems(r?.items ?? []);
          setRoItems([]);
        } else {
          const r = await dashApi.listDashboardResultObjectSources(siteId);
          if (cancelled) return;
          setRoItems(r?.items ?? []);
          setLdsItems([]);
        }
      } catch {
        if (!cancelled) {
          setLdsItems([]);
          setRoItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId, sourceType]);

  const selectedLds = useMemo(
    () => ldsItems.find((x) => x.id === sourceId),
    [ldsItems, sourceId],
  );
  const selectedRo = useMemo(() => roItems.find((x) => x.id === sourceId), [roItems, sourceId]);

  const fullLabel =
    sourceType === "latest_device_state"
      ? selectedLds
        ? formatLatestDeviceStateRowLabel(selectedLds)
        : sourceId
          ? `${sourceId.slice(0, 8)}…`
          : ""
      : selectedRo
        ? `${selectedRo.result_object_name} (${selectedRo.id.slice(0, 8)}…)`
        : sourceId
          ? `${sourceId.slice(0, 8)}…`
          : "";

  const displayText =
    fullLabel ||
    (sourceType === "latest_device_state" ? "— Select device stream —" : "— Select result object —");

  function openDialog() {
    if (disabled) return;
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <div className="dash-endpoint-group-field">
      <span className="dash-drawer__label" id={labelId}>
        Source
      </span>
      <button
        type="button"
        className="dash-endpoint-group-display dash-drawer__input"
        disabled={disabled || !siteId}
        onClick={openDialog}
        aria-haspopup="dialog"
        aria-labelledby={labelId}
        title={fullLabel ? `Open: ${fullLabel}` : "Choose source"}
      >
        <span className="dash-endpoint-group-display__text">{displayText}</span>
      </button>
      <dialog
        ref={dialogRef}
        className="dash-endpoint-group-dialog dash-individual-device-dialog"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDialog();
        }}
      >
        <div className="dash-endpoint-group-dialog__panel" onClick={(e) => e.stopPropagation()}>
          <h3 className="dash-endpoint-group-dialog__title">Individual device</h3>
          <p className="dash-endpoint-group-dialog__hint">
            Binding stores the row id (<code>latest_device_state</code> or <code>result_object</code>). The button shows the
            device or result name.
          </p>
          <div className="dash-endpoint-group-dialog__full" role="region" aria-label="Full source description">
            {fullLabel ? fullLabel : <span className="dash-widget__muted">No selection yet</span>}
          </div>
          <label className="dash-drawer__label dash-endpoint-group-dialog__select-label dash-endpoint-group-dialog__select-label--compact">
            Source type
            <div className="dash-endpoint-group-dialog__select-wrap">
              <select
                className="dash-drawer__input dash-endpoint-group-dialog__select"
                value={sourceType}
                disabled={disabled}
                onChange={(e) => {
                  const st = e.target.value as "latest_device_state" | "result_object";
                  onCommit(st, "");
                }}
              >
                <option value="latest_device_state">latest_device_state</option>
                <option value="result_object">result_object</option>
              </select>
            </div>
          </label>
          <label className="dash-drawer__label dash-endpoint-group-dialog__select-label dash-endpoint-group-dialog__select-label--compact">
            Change selection
            <div className="dash-endpoint-group-dialog__select-wrap">
              <select
                className="dash-drawer__input dash-endpoint-group-dialog__select"
                value={sourceId}
                disabled={disabled || loading}
                onChange={(e) => onCommit(sourceType, e.target.value)}
              >
                <option value="">— Select —</option>
                {sourceType === "latest_device_state"
                  ? ldsItems.map((x) => (
                      <option key={x.id} value={x.id}>
                        {formatLatestDeviceStateRowLabel(x)}
                      </option>
                    ))
                  : roItems.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.result_object_name} ({x.id.slice(0, 8)}…)
                      </option>
                    ))}
              </select>
            </div>
          </label>
          <div className="dash-endpoint-group-dialog__actions">
            <button type="button" className="dash-btn dash-btn--accent" onClick={closeDialog}>
              Done
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
