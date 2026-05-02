import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import {
  getEndpoint,
  getEndpointSampleFieldMetadata,
  getEndpointScrubberIdentityHints,
  publishEndpointIdentity,
  updateEndpoint,
  type EndpointRead,
  type PayloadFieldEntry,
} from "@/api/endpoints";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";

import "@/components/app/app-modal.css";
import "./endpoint-identity-panel.css";

function splitFields(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Match API `sample_document_for_validation` so JSON + field list use the same document shape. */
export function sampleDocumentForIdentityDisplay(ep: EndpointRead | null): Record<string, unknown> {
  if (!ep?.sample_payload) return {};
  const raw = ep.sample_payload;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const inner = (raw as { _aar_array_sample?: unknown })._aar_array_sample;
    if (Array.isArray(inner) && inner.length > 0 && typeof inner[0] === "object" && inner[0] !== null && !Array.isArray(inner[0])) {
      return { ...(inner[0] as Record<string, unknown>) };
    }
    return { ...(raw as Record<string, unknown>) };
  }
  if (Array.isArray(raw) && raw[0] && typeof raw[0] === "object" && raw[0] !== null) {
    return { ...(raw[0] as Record<string, unknown>) };
  }
  return {};
}

type Props = {
  endpointId: string;
  /** When set, panel shows a title bar with icon close (standalone modal usage). */
  onClose?: () => void;
  /** When true, outer title/close row is omitted (parent `AppModalShell` provides chrome). */
  embedded?: boolean;
};

export function EndpointIdentityPanel({ endpointId, onClose, embedded = false }: Props) {
  const [ep, setEp] = useState<EndpointRead | null>(null);
  const [fields, setFields] = useState<PayloadFieldEntry[]>([]);
  const [pkInput, setPkInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  useShellFeedback(err, ok);

  const load = useCallback(async () => {
    if (!endpointId) return;
    setLoading(true);
    setErr(null);
    try {
      const row = await getEndpoint(endpointId);
      if (!row) {
        setErr("Endpoint not found");
        return;
      }
      setEp(row);
      const draft = (row.identity_draft ?? {}) as {
        primary_device_key_fields?: string[];
        device_label_fields?: string[];
      };
      let pkStr = (draft.primary_device_key_fields ?? row.primary_device_key_fields ?? []).join(", ");
      let labelStr = (draft.device_label_fields ?? row.device_label_fields ?? []).join(", ");
      if (!pkStr.trim() || !labelStr.trim()) {
        try {
          const hints = await getEndpointScrubberIdentityHints(endpointId);
          if (hints) {
            if (!pkStr.trim() && hints.primary_device_key_fields.length) {
              pkStr = hints.primary_device_key_fields.join(", ");
            }
            if (!labelStr.trim() && hints.device_label_fields.length) {
              labelStr = hints.device_label_fields.join(", ");
            }
          }
        } catch {
          /* hints optional */
        }
      }
      setPkInput(pkStr);
      setLabelInput(labelStr);
      try {
        const meta = await getEndpointSampleFieldMetadata(endpointId);
        setFields(meta?.items ?? []);
      } catch {
        setFields([]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load endpoint");
    } finally {
      setLoading(false);
    }
  }, [endpointId]);

  useEffect(() => {
    void load();
  }, [load]);

  const displaySample = useMemo(() => sampleDocumentForIdentityDisplay(ep), [ep]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setSaving(true);
    try {
      const pk = splitFields(pkInput);
      const labels = splitFields(labelInput);
      await updateEndpoint(endpointId, {
        identity_draft: {
          primary_device_key_fields: pk,
          device_label_fields: labels,
        },
      });
      setOk("Saved");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onPublish() {
    setErr(null);
    setOk(null);
    setPublishing(true);
    try {
      await publishEndpointIdentity(endpointId);
      setOk("Identity published — endpoint is active for v2 resolution");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="eip-root">
      {!embedded ? (
        <div className="eip-header">
          <div>
            <h2 className="eip-title">{ep?.endpoint_name ?? "Endpoint identity"}</h2>
            {ep ? (
              <p className="eip-meta">
                Lifecycle: <strong>{ep.lifecycle_status}</strong>
                {ep.identity_published_at ? (
                  <>
                    {" "}
                    · Published <time dateTime={ep.identity_published_at}>{ep.identity_published_at}</time>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          {onClose ? (
            <button type="button" className="app-modal__close" onClick={onClose} aria-label="Close">
              <X size={20} strokeWidth={2} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : ep ? (
        <p className="eip-meta" style={{ marginTop: 0 }}>
          <strong className="eip-title" style={{ fontSize: "1rem", display: "block", marginBottom: "0.25rem" }}>
            {ep.endpoint_name}
          </strong>
          Lifecycle: <strong>{ep.lifecycle_status}</strong>
          {ep.identity_published_at ? (
            <>
              {" "}
              · Published <time dateTime={ep.identity_published_at}>{ep.identity_published_at}</time>
            </>
          ) : null}
        </p>
      ) : null}

      {loading ? <p className="eip-muted">Loading…</p> : null}

      {ep ? (
        <form className="eip-form" onSubmit={onSave}>
          <div className="eip-grid">
            <section className="eip-cell">
              <h3 className="eip-cell__title">Captured sample</h3>
              <p className="eip-cell__hint">Normalized JSON (same shape used for identity validation and field paths).</p>
              {Object.keys(displaySample).length > 0 ? (
                <pre className="eip-pre">{JSON.stringify(displaySample, null, 2)}</pre>
              ) : (
                <p className="eip-muted">No sample yet — send telemetry to this endpoint first.</p>
              )}
            </section>

            <section className="eip-cell">
              <h3 className="eip-cell__title">Sample fields</h3>
              <p className="eip-cell__hint">Paths derived from the captured sample (for authoring dotted paths).</p>
              {fields.length > 0 ? (
                <ul className="eip-field-list">
                  {fields.map((f) => (
                    <li key={f.path} className="eip-field-list__item">
                      <code className="eip-field-list__path">{f.path}</code>{" "}
                      <span className="eip-muted">({f.type})</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="eip-muted">No field catalog until a JSON sample exists.</p>
              )}
            </section>

            <section className="eip-cell">
              <h3 className="eip-cell__title">Primary identity paths</h3>
              <p className="eip-cell__hint">Comma-separated dotted paths on the scrubbed output payload.</p>
              <label className="eip-label">
                <input
                  className="eip-input"
                  value={pkInput}
                  onChange={(e) => setPkInput(e.target.value)}
                  placeholder="e.g. device_id, unit.serial"
                  autoComplete="off"
                />
              </label>
            </section>

            <section className="eip-cell">
              <h3 className="eip-cell__title">Label fields</h3>
              <p className="eip-cell__hint">Optional comma-separated paths for display labels.</p>
              <label className="eip-label">
                <input
                  className="eip-input"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  placeholder="optional"
                  autoComplete="off"
                />
              </label>
            </section>
          </div>

          <p className="eip-footnote">
            Paths must match the <strong>scrubbed output</strong> shape. Scrubber semantics (identity / display roles)
            suggest paths when this endpoint is linked to a device.
          </p>

          <div className="eip-actions">
            <button type="submit" className="dm-btn dm-btn--outline" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="dm-btn dm-btn--primary"
              disabled={publishing || !ep.sample_payload}
              onClick={() => void onPublish()}
            >
              {publishing ? "Publishing…" : "Publish identity"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
