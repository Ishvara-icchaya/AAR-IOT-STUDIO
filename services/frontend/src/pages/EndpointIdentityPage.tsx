import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  getEndpoint,
  getEndpointSampleFieldMetadata,
  publishEndpointIdentity,
  updateEndpoint,
  type EndpointRead,
  type PayloadFieldEntry,
} from "@/api/endpoints";
import { PageShell } from "@/layouts/PageShell";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";

function splitFields(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function EndpointIdentityPage() {
  const { endpointId } = useParams<{ endpointId: string }>();
  const [ep, setEp] = useState<EndpointRead | null>(null);
  const [fields, setFields] = useState<PayloadFieldEntry[]>([]);
  const [pkInput, setPkInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [loading, setLoading] = useState(false);
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
      setPkInput(
        (draft.primary_device_key_fields ?? row.primary_device_key_fields ?? []).join(", "),
      );
      setLabelInput((draft.device_label_fields ?? row.device_label_fields ?? []).join(", "));
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

  async function onSaveDraft(e: FormEvent) {
    e.preventDefault();
    if (!endpointId) return;
    setErr(null);
    setOk(null);
    try {
      const pk = splitFields(pkInput);
      const labels = splitFields(labelInput);
      await updateEndpoint(endpointId, {
        identity_draft: {
          primary_device_key_fields: pk,
          device_label_fields: labels,
        },
      });
      setOk("Draft saved");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function onPublish() {
    if (!endpointId) return;
    setErr(null);
    setOk(null);
    try {
      await publishEndpointIdentity(endpointId);
      setOk("Identity published — endpoint is active for v2 resolution");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Publish failed");
    }
  }

  if (!endpointId) {
    return (
      <PageShell title="Endpoint identity">
        <p>Missing endpoint id.</p>
      </PageShell>
    );
  }

  return (
    <PageShell title="Scrubber 2 — device identity">
      <div className="dash-widget__muted" style={{ marginBottom: 12 }}>
        <Link to="/devices/ingest">← Register Endpoints</Link>
      </div>
      {loading ? <p>Loading…</p> : null}
      {ep ? (
        <>
          <h2 style={{ marginTop: 0 }}>{ep.endpoint_name}</h2>
          <p className="dash-widget__muted">
            Lifecycle: <strong>{ep.lifecycle_status}</strong>
            {ep.identity_published_at ? (
              <>
                {" "}
                · Published <time dateTime={ep.identity_published_at}>{ep.identity_published_at}</time>
              </>
            ) : null}
          </p>
          <section style={{ marginBottom: 16 }}>
            <h3>Captured sample</h3>
            {ep.sample_payload ? (
              <pre
                style={{
                  maxHeight: 220,
                  overflow: "auto",
                  padding: 8,
                  background: "rgba(0,0,0,0.25)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                {JSON.stringify(ep.sample_payload, null, 2)}
              </pre>
            ) : (
              <p className="dash-widget__muted">No sample yet — send telemetry to this endpoint first.</p>
            )}
          </section>
          <section style={{ marginBottom: 16 }}>
            <h3>Sample fields</h3>
            {fields.length ? (
              <ul style={{ columns: 2, fontSize: 13 }}>
                {fields.slice(0, 40).map((f) => (
                  <li key={f.path}>
                    <code>{f.path}</code> <span className="dash-widget__muted">({f.type})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dash-widget__muted">No field catalog until a JSON sample exists.</p>
            )}
          </section>
          <form onSubmit={onSaveDraft} style={{ display: "grid", gap: 8, maxWidth: 560 }}>
            <label>
              <span className="dash-widget__muted">Primary identity paths (comma-separated)</span>
              <input
                style={{ width: "100%", maxWidth: 520 }}
                value={pkInput}
                onChange={(e) => setPkInput(e.target.value)}
                placeholder="e.g. deviceId, sensor.serial"
              />
            </label>
            <label>
              <span className="dash-widget__muted">Label fields (comma-separated dotted paths)</span>
              <input
                style={{ width: "100%", maxWidth: 520 }}
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="optional"
              />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit">Save draft</button>
              <button type="button" onClick={() => void onPublish()} disabled={!ep.sample_payload}>
                Publish identity
              </button>
            </div>
          </form>
        </>
      ) : null}
    </PageShell>
  );
}
