import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "@/api/client";
import {
  createPublishedService,
  fetchPublishedTargetDefaults,
  getPublishedService,
  listPsDataObjectSources,
  listPsResultObjectSources,
  updatePublishedService,
  type PublishedTargetDefaults,
} from "@/api/publishedServices";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type SiteOpt = { id: string; name: string };

export function PublishedServiceFormPage({ mode }: { mode: "create" | "edit" }) {
  const { serviceId } = useParams<{ serviceId: string }>();
  const nav = useNavigate();
  const [sites, setSites] = useState<SiteOpt[]>([]);
  const [siteId, setSiteId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState<"data_object" | "result_object">("data_object");
  const [sourceObjectId, setSourceObjectId] = useState("");
  const [sourceObjectName, setSourceObjectName] = useState("");
  const [protocol, setProtocol] = useState<"rest" | "mqtt">("rest");
  const [targetJson, setTargetJson] = useState('{\n  "url": "https://example.com/hook",\n  "method": "POST",\n  "timeout_seconds": 30\n}');
  const [status, setStatus] = useState("draft");
  const [err, setErr] = useState<string | null>(null);
  const [sources, setSources] = useState<{ id: string; label: string }[]>([]);
  const [platformDefaults, setPlatformDefaults] = useState<PublishedTargetDefaults | null>(null);

  useEffect(() => {
    void (async () => {
      const siteList = await apiFetch<SiteOpt[]>("/administration/sites");
      setSites(siteList ?? []);
      if (mode === "create" && siteList?.length && !siteId) setSiteId(siteList[0].id);
    })();
  }, []);

  useEffect(() => {
    if (mode !== "create") return;
    void (async () => {
      try {
        const d = await fetchPublishedTargetDefaults();
        if (d) setPlatformDefaults(d);
      } catch {
        /* keep example JSON if defaults fetch fails */
      }
    })();
  }, [mode]);

  useEffect(() => {
    if (mode !== "create" || !platformDefaults) return;
    const cfg =
      protocol === "rest" ? platformDefaults.rest_target_config_json : platformDefaults.mqtt_target_config_json;
    setTargetJson(JSON.stringify(cfg, null, 2));
  }, [mode, protocol, platformDefaults]);

  useEffect(() => {
    if (!siteId) return;
    void (async () => {
      try {
        if (sourceType === "data_object") {
          const r = await listPsDataObjectSources(siteId);
          setSources(
            (r?.items ?? []).map((x) => ({ id: x.id, label: `${x.name} (${x.lifecycle_status})` })),
          );
        } else {
          const r = await listPsResultObjectSources(siteId);
          setSources((r?.items ?? []).map((x) => ({ id: x.id, label: x.result_object_name })));
        }
      } catch {
        setSources([]);
      }
    })();
  }, [siteId, sourceType]);

  useEffect(() => {
    if (mode !== "edit" || !serviceId) return;
    void (async () => {
      try {
        const s = await getPublishedService(serviceId);
        if (!s) return;
        setSiteId(s.site_id);
        setName(s.name);
        setDescription(s.description ?? "");
        setSourceType(s.source_type as "data_object" | "result_object");
        setSourceObjectId(s.source_object_id);
        setSourceObjectName(s.source_object_name);
        setProtocol(s.publish_protocol as "rest" | "mqtt");
        setTargetJson(JSON.stringify(s.target_config_json ?? {}, null, 2));
        setStatus(s.status);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Load failed");
      }
    })();
  }, [mode, serviceId]);

  function applySourceSelection(id: string) {
    setSourceObjectId(id);
    const hit = sources.find((s) => s.id === id);
    if (hit) setSourceObjectName(hit.label.split(" (")[0] ?? hit.label);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(targetJson) as Record<string, unknown>;
    } catch {
      setErr("Target config must be valid JSON");
      return;
    }
    const body = {
      site_id: siteId,
      name,
      description: description || null,
      source_type: sourceType,
      source_object_id: sourceObjectId,
      source_object_name: sourceObjectName,
      publish_protocol: protocol,
      target_config_json: cfg,
      status,
    };
    try {
      if (mode === "create") {
        const row = await createPublishedService(body);
        if (row?.id) nav(`/published-services/${row.id}/edit`);
        else nav("/published-services");
      } else if (serviceId) {
        await updatePublishedService(serviceId, {
          site_id: siteId,
          name,
          description: description || null,
          source_object_name: sourceObjectName,
          publish_protocol: protocol,
          target_config_json: cfg,
          status,
        });
        nav("/published-services");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <PageShell style={{ maxWidth: "640px", margin: "0 auto" }}>
      <p>
        <Link to="/published-services" style={{ color: "var(--color-accent)" }}>
          ← Published services
        </Link>
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
        <label style={lbl}>
          Site *
          <select required value={siteId} onChange={(e) => setSiteId(e.target.value)} style={inp}>
            <option value="">Select…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label style={lbl}>
          Name *
          <input required value={name} onChange={(e) => setName(e.target.value)} style={inp} />
        </label>
        <label style={lbl}>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={inp} />
        </label>
        <label style={lbl}>
          Source type *
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
            style={inp}
            disabled={mode === "edit"}
          >
            <option value="data_object">data_object</option>
            <option value="result_object">result_object</option>
          </select>
        </label>
        <label style={lbl}>
          Source object *
          <select
            required
            value={sourceObjectId}
            onChange={(e) => applySourceSelection(e.target.value)}
            style={inp}
            disabled={mode === "edit"}
          >
            <option value="">Select…</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {mode === "edit" && (
          <label style={lbl}>
            Source display name
            <input value={sourceObjectName} onChange={(e) => setSourceObjectName(e.target.value)} style={inp} />
          </label>
        )}
        <label style={lbl}>
          Protocol *
          <select value={protocol} onChange={(e) => setProtocol(e.target.value as typeof protocol)} style={inp}>
            <option value="rest">REST</option>
            <option value="mqtt">MQTT</option>
          </select>
        </label>
        <label style={lbl}>
          Target config (JSON) *
          {mode === "create" && platformDefaults ? (
            <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
              Prefilled from Administration → Configure Ports (publishing defaults).
            </span>
          ) : null}
          <textarea
            required
            value={targetJson}
            onChange={(e) => setTargetJson(e.target.value)}
            rows={12}
            style={{ ...inp, fontFamily: "monospace", fontSize: "0.8rem" }}
          />
        </label>
        <label style={lbl}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={inp}>
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="stopped">stopped</option>
            <option value="failed">failed</option>
            <option value="inactive">inactive</option>
          </select>
        </label>
        <button type="submit" style={btn}>
          Save
        </button>
      </form>
    </PageShell>
  );
}

const lbl: CSSProperties = { display: "grid", gap: "0.25rem", fontSize: "0.85rem", color: "var(--color-text-muted)" };
const inp: CSSProperties = {
  padding: "0.45rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
};
const btn: CSSProperties = {
  padding: "0.55rem",
  borderRadius: "var(--radius)",
  border: "none",
  background: "var(--color-accent)",
  color: "var(--btn-on-accent)",
  fontWeight: 600,
  cursor: "pointer",
};
