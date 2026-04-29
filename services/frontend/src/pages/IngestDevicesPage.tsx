import { FormEvent, useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/api/client";
import { createEndpoint, listEndpoints, updateEndpoint, type EndpointRead } from "@/api/endpoints";
import { PageShell } from "@/layouts/PageShell";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";

type SiteRow = { id: string; name: string };

type FormState = {
  site_id: string;
  endpoint_name: string;
  protocol: string;
  object_name: string;
  primary_device_key_fields: string;
  device_label_fields: string;
};

const EMPTY_FORM: FormState = {
  site_id: "",
  endpoint_name: "",
  protocol: "mqtt",
  object_name: "",
  primary_device_key_fields: "",
  device_label_fields: "",
};

function splitFields(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** UX “Device” list — internal resource is `/api/v1/endpoints`. */
export function IngestDevicesPage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<EndpointRead[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState<EndpointRead | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  useShellFeedback(err, ok);

  const filtered = useMemo(() => items, [items]);

  useEffect(() => {
    void apiFetch<SiteRow[]>("/administration/sites")
      .then((rows) => {
        const vals = rows ?? [];
        setSites(vals);
      })
      .catch(() => setSites([]));
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await listEndpoints({ site_id: siteId || undefined, q: q || undefined });
        setItems(r?.items ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load endpoints");
      } finally {
        setLoading(false);
      }
    })();
  }, [siteId, q]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    try {
      if (!form.site_id && !editing) throw new Error("site_id is required");
      const pk = splitFields(form.primary_device_key_fields);
      const body = {
        site_id: editing ? editing.site_id : form.site_id,
        endpoint_name: form.endpoint_name.trim(),
        protocol: form.protocol.trim().toLowerCase(),
        object_name: form.object_name.trim(),
        primary_device_key_fields: pk,
        device_label_fields: splitFields(form.device_label_fields),
        enabled: true,
      };
      if (editing) {
        await updateEndpoint(editing.id, body);
        setOk("Endpoint updated");
      } else {
        await createEndpoint(body);
        setOk("Endpoint created");
      }
      setForm(EMPTY_FORM);
      setEditing(null);
      const r = await listEndpoints({ site_id: siteId || undefined, q: q || undefined });
      setItems(r?.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  function startEdit(ep: EndpointRead) {
    setEditing(ep);
    setForm({
      site_id: ep.site_id,
      endpoint_name: ep.endpoint_name,
      protocol: ep.protocol,
      object_name: ep.object_name,
      primary_device_key_fields: (ep.primary_device_key_fields ?? []).join(", "),
      device_label_fields: (ep.device_label_fields ?? []).join(", "),
    });
  }

  return (
    <PageShell title="Manage Endpoints">
      <div className="dash-widget__muted" style={{ marginBottom: 12 }}>
        Endpoints are the ingest system-of-record. Devices in UX are resolved identities beneath endpoints.
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">All sites</option>
          {(sites ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Search endpoint name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        <strong>{editing ? "Edit endpoint" : "Create endpoint"}</strong>
        {!editing ? (
          <select
            value={form.site_id}
            onChange={(e) => setForm((f) => ({ ...f, site_id: e.target.value }))}
            required
          >
            <option value="">Select site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : null}
        <input
          placeholder="Endpoint name"
          value={form.endpoint_name}
          onChange={(e) => setForm((f) => ({ ...f, endpoint_name: e.target.value }))}
          required
        />
        <input
          placeholder="Protocol (mqtt/http/coap/ws)"
          value={form.protocol}
          onChange={(e) => setForm((f) => ({ ...f, protocol: e.target.value }))}
          required
        />
        <input
          placeholder="Object name"
          value={form.object_name}
          onChange={(e) => setForm((f) => ({ ...f, object_name: e.target.value }))}
          required
        />
        <input
          placeholder="Primary key fields (optional; comma separated — or map in Scrubber 2.0)"
          value={form.primary_device_key_fields}
          onChange={(e) => setForm((f) => ({ ...f, primary_device_key_fields: e.target.value }))}
        />
        <input
          placeholder="Device label fields (comma separated)"
          value={form.device_label_fields}
          onChange={(e) => setForm((f) => ({ ...f, device_label_fields: e.target.value }))}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit">{editing ? "Update" : "Create"}</button>
          {editing ? (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setForm(EMPTY_FORM);
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {err ? <p style={{ color: "#f88" }}>{err}</p> : null}
      {ok ? <p style={{ color: "#7fd17f" }}>{ok}</p> : null}
      {loading ? <p>Loading…</p> : null}

      <table className="dash-widget__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Protocol</th>
            <th>Object</th>
            <th>Site</th>
            <th>Lifecycle</th>
            <th>PK Fields</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filtered.map((ep) => (
            <tr key={ep.id}>
              <td>{ep.endpoint_name}</td>
              <td>{ep.protocol}</td>
              <td>{ep.object_name}</td>
              <td>{ep.site_id.slice(0, 8)}…</td>
              <td>{ep.lifecycle_status ?? "—"}</td>
              <td>{(ep.primary_device_key_fields ?? []).join(", ") || "—"}</td>
              <td>
                <button type="button" onClick={() => startEdit(ep)}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={7}>No endpoints found.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </PageShell>
  );
}

