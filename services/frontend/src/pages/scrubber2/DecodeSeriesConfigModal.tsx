import { useEffect, useMemo, useState } from "react";
import type { DecodeSeriesEngineMode, DecodeSeriesSuggestion } from "@/lib/scrubber2DecodeSeriesFromField";
import {
  buildDecodeSeriesStepRecord,
  DECODE_SERIES_AGG_DEFAULT,
  targetPathForDecodedSource,
} from "@/lib/scrubber2DecodeSeriesFromField";

const BINARY_DT = ["int16", "int32", "float32"] as const;
const ARRAY_SCALAR_DT = ["float", "int", "int16", "int32", "float32"] as const;

type Props = {
  open: boolean;
  sourcePath: string;
  suggestion: DecodeSeriesSuggestion;
  onClose: () => void;
  onConfirm: (step: Record<string, unknown>) => void;
};

export function DecodeSeriesConfigModal({ open, sourcePath, suggestion, onClose, onConfirm }: Props) {
  const [targetPath, setTargetPath] = useState("");
  const [mode, setMode] = useState<DecodeSeriesEngineMode>(suggestion.mode);
  const [dataType, setDataType] = useState(suggestion.dataType);
  const [byteOrder, setByteOrder] = useState<"little" | "big">("little");
  const [scale, setScale] = useState("1");
  const [offset, setOffset] = useState("0");
  const [unit, setUnit] = useState("");
  const [storeSamples, setStoreSamples] = useState(true);
  const [maxSamples, setMaxSamples] = useState("1000");
  const [aggs, setAggs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(DECODE_SERIES_AGG_DEFAULT.map((a) => [a, true])),
  );

  useEffect(() => {
    if (!open) return;
    setTargetPath(targetPathForDecodedSource(sourcePath));
    setMode(suggestion.mode);
    setDataType(suggestion.dataType);
    setByteOrder("little");
    setScale("1");
    setOffset("0");
    setUnit("");
    setStoreSamples(true);
    setMaxSamples("1000");
    setAggs(Object.fromEntries(DECODE_SERIES_AGG_DEFAULT.map((a) => [a, true])));
  }, [open, sourcePath, suggestion]);

  const dataTypeOptions = useMemo(() => {
    if (mode === "base64_binary" || mode === "hex_binary") return [...BINARY_DT];
    return [...ARRAY_SCALAR_DT];
  }, [mode]);

  useEffect(() => {
    if (!dataTypeOptions.includes(dataType as (typeof BINARY_DT)[number] | (typeof ARRAY_SCALAR_DT)[number])) {
      setDataType(dataTypeOptions[0]);
    }
  }, [dataTypeOptions, dataType]);

  if (!open) return null;

  const toggleAgg = (k: string) => setAggs((a) => ({ ...a, [k]: !a[k] }));

  const submit = () => {
    const sc = parseFloat(scale);
    const off = parseFloat(offset);
    const mx = parseInt(maxSamples, 10);
    const chosenAggs = DECODE_SERIES_AGG_DEFAULT.filter((a) => aggs[a]);
    const step = buildDecodeSeriesStepRecord({
      sourcePath,
      targetPath: targetPath.trim() || targetPathForDecodedSource(sourcePath),
      mode,
      dataType,
      byteOrder,
      scale: Number.isFinite(sc) ? sc : 1,
      offset: Number.isFinite(off) ? off : 0,
      unit,
      storeSamples,
      maxSamplesToStore: Number.isFinite(mx) ? mx : 1000,
      aggregations: chosenAggs.length ? [...chosenAggs] : ["latest", "count"],
    });
    onConfirm(step);
    onClose();
  };

  return (
    <div
      className="scrubber2-ds-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="scrubber2-ds-modal" role="dialog" aria-modal="true" aria-labelledby="scrubber2-ds-title">
        <h3 id="scrubber2-ds-title" style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>
          Configure decode series
        </h3>
        <p className="scrubber2-muted" style={{ margin: "0 0 0.75rem", fontSize: "0.78rem", lineHeight: 1.4 }}>
          Detection suggests a <strong>{suggestion.detected}</strong> field at <code>{sourcePath}</code>. This adds a
          real <code>decode_series</code> step to the draft (engine order: after scalar renames, before derived Python).
          Adjust defaults before confirming.
        </p>
        <div className="scrubber2-ds-grid">
          <label className="scrubber2-ds-field">
            <span>Source path</span>
            <input className="scrubber2-input" readOnly value={sourcePath} />
          </label>
          <label className="scrubber2-ds-field">
            <span>Target path</span>
            <input className="scrubber2-input" value={targetPath} onChange={(e) => setTargetPath(e.target.value)} />
          </label>
          <label className="scrubber2-ds-field">
            <span>Mode</span>
            <select
              className="scrubber2-input"
              value={mode}
              onChange={(e) => setMode(e.target.value as DecodeSeriesEngineMode)}
            >
              <option value="base64_binary">base64_binary</option>
              <option value="hex_binary">hex_binary</option>
              <option value="csv_numbers">csv_numbers</option>
              <option value="array">array</option>
              <option value="scalar">scalar</option>
            </select>
          </label>
          <label className="scrubber2-ds-field">
            <span>Data type</span>
            <select className="scrubber2-input" value={dataType} onChange={(e) => setDataType(e.target.value)}>
              {dataTypeOptions.map((dt) => (
                <option key={dt} value={dt}>
                  {dt}
                </option>
              ))}
            </select>
          </label>
          {mode === "base64_binary" || mode === "hex_binary" ? (
            <label className="scrubber2-ds-field">
              <span>Byte order</span>
              <select
                className="scrubber2-input"
                value={byteOrder}
                onChange={(e) => setByteOrder(e.target.value as "little" | "big")}
              >
                <option value="little">little</option>
                <option value="big">big</option>
              </select>
            </label>
          ) : null}
          <label className="scrubber2-ds-field">
            <span>Scale</span>
            <input className="scrubber2-input" value={scale} onChange={(e) => setScale(e.target.value)} />
          </label>
          <label className="scrubber2-ds-field">
            <span>Offset</span>
            <input className="scrubber2-input" value={offset} onChange={(e) => setOffset(e.target.value)} />
          </label>
          <label className="scrubber2-ds-field">
            <span>Unit (optional)</span>
            <input
              className="scrubber2-input"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. mA"
            />
          </label>
          <label className="scrubber2-ds-field">
            <span>Max samples to store</span>
            <input
              className="scrubber2-input"
              type="number"
              min={0}
              value={maxSamples}
              onChange={(e) => setMaxSamples(e.target.value)}
            />
          </label>
          <label className="scrubber2-ds-field scrubber2-ds-field--row">
            <input type="checkbox" checked={storeSamples} onChange={(e) => setStoreSamples(e.target.checked)} />
            <span>Store samples</span>
          </label>
        </div>
        <div style={{ marginTop: "0.65rem" }}>
          <div className="scrubber2-muted" style={{ fontSize: "0.72rem", marginBottom: "0.25rem" }}>
            Aggregations
          </div>
          <div className="scrubber2-chip-row">
            {DECODE_SERIES_AGG_DEFAULT.map((a) => (
              <button
                key={a}
                type="button"
                className={`scrubber2-chip${aggs[a] ? " scrubber2-chip--on" : ""}`}
                onClick={() => toggleAgg(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="scrubber2-ds-actions">
          <button type="button" className="scrubber2-btn scrubber2-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="scrubber2-btn scrubber2-btn--primary" onClick={submit}>
            Add step to draft
          </button>
        </div>
      </div>
    </div>
  );
}
