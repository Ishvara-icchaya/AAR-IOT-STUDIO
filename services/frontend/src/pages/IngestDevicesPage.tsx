import type { Dispatch, SetStateAction } from "react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Braces, ChevronLeft, ChevronRight, GitBranch, Pencil, Plus, Search } from "lucide-react";

import { apiFetch, isApiHttpError } from "@/api/client";
import { listDevices, type DeviceRead } from "@/api/devices";
import { createEndpoint, listEndpoints, updateEndpoint, type EndpointRead } from "@/api/endpoints";
import { PageStatus } from "@/components/PageStatus";
import { OpsActionButton } from "@/components/ops/OpsActionButton";
import { OpsDataTable } from "@/components/ops/OpsDataTable";
import { OpsFilterPanel } from "@/components/ops/OpsFilterPanel";
import { OpsScopeControls } from "@/components/ops/OpsScopeControls";
import { OpsKpiRow } from "@/components/ops/OpsKpiRow";
import { AppModalShell } from "@/components/app/AppModalShell";
import { EndpointIdentityPanel } from "@/components/endpoint/EndpointIdentityPanel";
import { OpsPageHeader } from "@/components/ops/OpsPageHeader";
import { OpsStatusPill, type OpsVariant } from "@/components/ops/OpsStatusPill";
import { AarButton } from "@/components/system/AarButton";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { useSitePermissionsOptional } from "@/contexts/SitePermissionsContext";
import { PageShell } from "@/layouts/PageShell";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";
import { ScrubbedEventsSelectModal } from "@/pages/scrubber2/ScrubbedEventsSelectModal";
import {
  DEVICE_LABEL_PATH_OPTIONS,
  ENDPOINT_LIFECYCLE_FILTERS,
  PRIMARY_KEY_PATH_OPTIONS,
  V2_ENDPOINT_PROTOCOL_OPTIONS,
  isValidCustomEndpointName,
  protocolLabelForTable,
} from "@/lib/ingestEndpointFormOptions";
import { normalizeProtocol, type IngestProtocol } from "@/lib/deviceEndpointConfig";
import { ICON_SIZES, ICON_STROKE_WIDTH } from "@/lib/appIcons";

import "./device-register-page.css";
import "./ingest-endpoints-page.css";
import "@/components/endpoint/endpoint-identity-panel.css";

type SiteRow = { id: string; name: string };

const PAGE_SIZE = 25;

function lifecyclePillVariant(s: string | null | undefined): OpsVariant {
  const v = (s || "").toLowerCase();
  if (v === "active") return "online";
  if (v === "needs_identity_mapping") return "muted";
  if (v === "error") return "offline";
  if (v === "disabled") return "disabled";
  return "muted";
}

export function IngestDevicesPage() {
  const { siteId: opsSiteId, refreshToken } = useOpsShell();
  const sitePerms = useSitePermissionsOptional();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [filterProtocol, setFilterProtocol] = useState<string>("all");
  const [filterLifecycle, setFilterLifecycle] = useState<string>("all");
  const [items, setItems] = useState<EndpointRead[]>([]);
  const [devices, setDevices] = useState<DeviceRead[]>([]);
  const [loading, setLoading] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [formSiteId, setFormSiteId] = useState("");
  const [endpointName, setEndpointName] = useState("");
  const [protocol, setProtocol] = useState(V2_ENDPOINT_PROTOCOL_OPTIONS[1]?.value ?? "mqtt");
  const [linkDeviceEndpointId, setLinkDeviceEndpointId] = useState("");
  const [pkSelected, setPkSelected] = useState<Set<string>>(() => new Set());
  const [labelSelected, setLabelSelected] = useState<Set<string>>(() => new Set());
  const [pkExtras, setPkExtras] = useState<string[]>([]);
  const [labelExtras, setLabelExtras] = useState<string[]>([]);
  const [editing, setEditing] = useState<EndpointRead | null>(null);
  const [endpointModalOpen, setEndpointModalOpen] = useState(false);
  const [identityModalId, setIdentityModalId] = useState<string | null>(null);
  const [scrubbedModalOpen, setScrubbedModalOpen] = useState(false);
  const [scrubbedEndpointId, setScrubbedEndpointId] = useState("");
  const [scrubbedEndpointLabel, setScrubbedEndpointLabel] = useState("");
  const [lineageModalOpen, setLineageModalOpen] = useState(false);

  useShellFeedback(err, ok);

  const openScrubbedEventsModal = useCallback((ep: EndpointRead) => {
    setScrubbedEndpointId(ep.id);
    setScrubbedEndpointLabel(ep.endpoint_name);
    setScrubbedModalOpen(true);
  }, []);

  const closeScrubbedEventsModal = useCallback(() => {
    setScrubbedModalOpen(false);
    setScrubbedEndpointId("");
    setScrubbedEndpointLabel("");
  }, []);

  useEffect(() => {
    const id = searchParams.get("identity")?.trim();
    if (id) setIdentityModalId(id);
  }, [searchParams]);

  const closeIdentityModal = useCallback(() => {
    setIdentityModalId(null);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete("identity");
        return n;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const canEndpointsWrite = Boolean(sitePerms && !sitePerms.loading && sitePerms.hasUnion("endpoints.write"));

  useEffect(() => {
    void apiFetch<SiteRow[]>("/administration/sites")
      .then((rows) => setSites(rows ?? []))
      .catch(() => setSites([]));
  }, []);

  const loadEndpoints = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await listEndpoints({
        site_id: opsSiteId ?? undefined,
        q: appliedQ.trim() || undefined,
      });
      setItems(r?.items ?? []);
      setPage(0);
    } catch (e) {
      setErr(
        isApiHttpError(e)
          ? e.message.trim() || `Failed to load endpoints (${e.status})`
          : e instanceof Error
            ? e.message
            : "Failed to load endpoints",
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [opsSiteId, appliedQ]);

  useEffect(() => {
    void loadEndpoints();
  }, [loadEndpoints, refreshToken]);

  useEffect(() => {
    const sid = formSiteId || opsSiteId;
    if (!sid) {
      setDevices([]);
      return;
    }
    let cancelled = false;
    setDevicesLoading(true);
    void listDevices({ site_id: sid })
      .then((rows) => {
        if (!cancelled) setDevices(rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setDevices([]);
      })
      .finally(() => {
        if (!cancelled) setDevicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [formSiteId, opsSiteId, refreshToken]);

  useEffect(() => setPage(0), [appliedQ, filterProtocol, filterLifecycle, opsSiteId]);

  const sitesById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of sites) m[s.id] = s.name;
    return m;
  }, [sites]);

  const deviceEndpointIdToDeviceName = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of devices) {
      if (d.endpoint?.id) m.set(d.endpoint.id, d.name);
    }
    return m;
  }, [devices]);

  const linkableDevices = useMemo(
    () =>
      devices.filter((d) =>
        d.endpoint?.id && (formSiteId || opsSiteId ? d.site_id === (formSiteId || opsSiteId || "") : true),
      ),
    [devices, formSiteId, opsSiteId],
  );

  const filteredItems = useMemo(() => {
    let rows = items;
    if (filterProtocol !== "all") {
      rows = rows.filter((ep) => (ep.protocol || "").toLowerCase() === filterProtocol);
    }
    if (filterLifecycle !== "all") {
      rows = rows.filter((ep) => (ep.lifecycle_status || "").toLowerCase() === filterLifecycle);
    }
    return rows;
  }, [items, filterProtocol, filterLifecycle]);

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));
  const pageRows = filteredItems.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const kpi = useMemo(() => {
    let linked = 0;
    let mqtt = 0;
    for (const ep of filteredItems) {
      if (ep.device_endpoint_id) linked += 1;
      if ((ep.protocol || "").toLowerCase() === "mqtt") mqtt += 1;
    }
    return { total: filteredItems.length, linked, mqtt };
  }, [filteredItems]);

  function resetForm() {
    setEditing(null);
    setFormSiteId(opsSiteId || "");
    setEndpointName("");
    setProtocol(V2_ENDPOINT_PROTOCOL_OPTIONS[1]?.value ?? "mqtt");
    setLinkDeviceEndpointId("");
    setPkSelected(new Set());
    setLabelSelected(new Set());
    setPkExtras([]);
    setLabelExtras([]);
  }

  function openCreateEndpointModal() {
    resetForm();
    setEndpointModalOpen(true);
  }

  function startEdit(ep: EndpointRead) {
    setEditing(ep);
    setFormSiteId(ep.site_id);
    const normProto = normalizeProtocol((ep.protocol || "mqtt").toLowerCase()) as IngestProtocol;
    setProtocol(V2_ENDPOINT_PROTOCOL_OPTIONS.some((o) => o.value === normProto) ? normProto : "mqtt");
    setEndpointName(ep.endpoint_name);
    setLinkDeviceEndpointId(ep.device_endpoint_id ?? "");
    const pk =
      (ep.identity_draft as { primary_device_key_fields?: string[] } | undefined)?.primary_device_key_fields ??
      ep.primary_device_key_fields ??
      [];
    const dl =
      (ep.identity_draft as { device_label_fields?: string[] } | undefined)?.device_label_fields ??
      ep.device_label_fields ??
      [];
    const pkSet = new Set(pk);
    const pkCommon = PRIMARY_KEY_PATH_OPTIONS.filter((p) => pkSet.has(p));
    const pkExtra = pk.filter((x) => !PRIMARY_KEY_PATH_OPTIONS.includes(x as (typeof PRIMARY_KEY_PATH_OPTIONS)[number]));
    setPkSelected(new Set(pkCommon));
    setPkExtras(pkExtra);
    const dlSet = new Set(dl);
    const dlCommon = DEVICE_LABEL_PATH_OPTIONS.filter((p) => dlSet.has(p));
    const dlExtra = dl.filter((x) => !DEVICE_LABEL_PATH_OPTIONS.includes(x as (typeof DEVICE_LABEL_PATH_OPTIONS)[number]));
    setLabelSelected(new Set(dlCommon));
    setLabelExtras(dlExtra);
    setEndpointModalOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    const name = endpointName.trim();
    if (!name) {
      setErr("Endpoint name is required.");
      return;
    }
    if (!isValidCustomEndpointName(name)) {
      setErr("Endpoint name: use letters, numbers, spaces, dot, hyphen, or underscore (1–255 chars).");
      return;
    }
    if (!editing && !formSiteId.trim()) {
      setErr("Select a site for the new endpoint.");
      return;
    }
    try {
      const pk = [...Array.from(pkSelected), ...pkExtras];
      const dl = [...Array.from(labelSelected), ...labelExtras];
      if (editing) {
        await updateEndpoint(editing.id, {
          endpoint_name: name,
          protocol,
          primary_device_key_fields: pk.length ? pk : null,
          device_label_fields: dl.length ? dl : null,
          enabled: true,
          device_endpoint_id: linkDeviceEndpointId.trim() || null,
        });
        setOk("Endpoint updated.");
      } else {
        await createEndpoint({
          site_id: formSiteId,
          endpoint_name: name,
          protocol,
          primary_device_key_fields: pk.length ? pk : null,
          device_label_fields: dl.length ? dl : null,
          enabled: true,
          device_endpoint_id: linkDeviceEndpointId.trim() || null,
        });
        setOk("Endpoint created.");
      }
      setEndpointModalOpen(false);
      resetForm();
      await loadEndpoints();
    } catch (ex) {
      setErr(
        isApiHttpError(ex)
          ? ex.message.trim() || `Save failed (${ex.status})`
          : ex instanceof Error
            ? ex.message
            : "Save failed",
      );
    }
  }

  function onFilterSearch(e: FormEvent) {
    e.preventDefault();
    setAppliedQ(searchInput.trim());
  }

  function toggleInSet(setter: Dispatch<SetStateAction<Set<string>>>, key: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const endpointForm = (
    <form className="ingest-ept-form-grid" onSubmit={onSubmit}>
      {!editing ? (
        <label className="dm-filter-field">
          <span>Site</span>
          <select
            className="dm-search-input"
            required
            value={formSiteId}
            onChange={(e) => setFormSiteId(e.target.value)}
          >
            <option value="">Select site…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="dash-widget__muted" style={{ fontSize: "0.8rem", margin: 0 }}>
          Site is fixed for this endpoint ({sitesById[editing.site_id] ?? editing.site_id.slice(0, 8) + "…"}).
        </p>
      )}

      <label className="dm-filter-field">
        <span>Endpoint name</span>
        <input
          className="dm-search-input"
          value={endpointName}
          onChange={(e) => setEndpointName(e.target.value)}
          maxLength={255}
          placeholder="e.g. Fleet MQTT Telemetry"
          autoComplete="off"
          required
          aria-label="Endpoint name"
        />
      </label>
      <p className="dash-widget__muted" style={{ fontSize: "0.75rem", margin: "-0.2rem 0 0" }}>
        Internal stream key (<code>endpoints.object_name</code>) is set by the API when the endpoint is created (
        <code>stream_</code> + endpoint id) and cannot be edited here.
      </p>

      <label className="dm-filter-field">
        <span>Protocol</span>
        <select className="dm-search-input" value={protocol} onChange={(e) => setProtocol(e.target.value as IngestProtocol)}>
          {V2_ENDPOINT_PROTOCOL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="dm-filter-field">
        <span>Link to device endpoint</span>
        <select
          className="dm-search-input"
          value={linkDeviceEndpointId}
          onChange={(e) => setLinkDeviceEndpointId(e.target.value)}
          disabled={!formSiteId && !editing}
          aria-label="Link device endpoint"
        >
          <option value="">— Not linked —</option>
          {linkableDevices.map((d) =>
            d.endpoint?.id ? (
              <option key={d.endpoint.id} value={d.endpoint.id}>
                {d.name} · {protocolLabelForTable(d.endpoint.protocol ?? "")}
              </option>
            ) : null,
          )}
        </select>
      </label>
      {!formSiteId && !editing ? (
        <p className="dash-widget__muted" style={{ fontSize: "0.75rem", margin: 0 }}>
          Select a site to load devices for linking.
        </p>
      ) : null}

      <fieldset className="ingest-ept-fieldset">
        <legend>Primary key JSON paths</legend>
        <div className="ingest-ept-check-grid">
          {PRIMARY_KEY_PATH_OPTIONS.map((path) => (
            <label key={path} className="ingest-ept-check">
              <input type="checkbox" checked={pkSelected.has(path)} onChange={() => toggleInSet(setPkSelected, path)} />
              <code>{path}</code>
            </label>
          ))}
        </div>
        {pkExtras.length > 0 ? (
          <p className="dash-widget__muted" style={{ fontSize: "0.72rem", margin: "0.5rem 0 0" }}>
            Additional PK paths on this endpoint (preserved on save): <code>{pkExtras.join(", ")}</code>
          </p>
        ) : null}
      </fieldset>

      <fieldset className="ingest-ept-fieldset">
        <legend>Device label JSON paths</legend>
        <div className="ingest-ept-check-grid">
          {DEVICE_LABEL_PATH_OPTIONS.map((path) => (
            <label key={path} className="ingest-ept-check">
              <input type="checkbox" checked={labelSelected.has(path)} onChange={() => toggleInSet(setLabelSelected, path)} />
              <code>{path}</code>
            </label>
          ))}
        </div>
        {labelExtras.length > 0 ? (
          <p className="dash-widget__muted" style={{ fontSize: "0.72rem", margin: "0.5rem 0 0" }}>
            Additional label paths on this endpoint (preserved on save): <code>{labelExtras.join(", ")}</code>
          </p>
        ) : null}
      </fieldset>

      <div className="ingest-ept-actions ingest-ept-actions--modal-footer">
        <AarButton type="button" variant="outline" onClick={() => { resetForm(); setEndpointModalOpen(false); }}>
          Cancel
        </AarButton>
        <AarButton type="submit" variant="primary" disabled={loading || !canEndpointsWrite} title={!canEndpointsWrite ? "Requires endpoints.write" : undefined}>
          {editing ? "Save Changes" : "Create Endpoint"}
        </AarButton>
      </div>
    </form>
  );

  return (
    <PageShell variant="list" className="ingest-ept-page device-manage-page">
      <div className="dm-root">
        <OpsPageHeader
          title="Endpoints"
          subtitle="Create v2 ingest endpoints, link registered device endpoints, and map identity for resolution."
          actions={
            <>
              <button
                type="button"
                className="dm-btn dm-btn--outline"
                onClick={() => setLineageModalOpen(true)}
              >
                <GitBranch size={16} strokeWidth={2} aria-hidden style={{ verticalAlign: "middle", marginRight: 6 }} />
                View Lineage
              </button>
              <button type="button" className="dm-btn dm-btn--primary" onClick={openCreateEndpointModal} disabled={!canEndpointsWrite} title={!canEndpointsWrite ? "Requires endpoints.write" : undefined}>
                <Plus size={16} strokeWidth={2} aria-hidden style={{ verticalAlign: "middle", marginRight: 6 }} />
                Create Endpoint
              </button>
            </>
          }
        />

        <OpsKpiRow ariaLabel="Endpoint summary" className="dm-kpi-row--equal-5">
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Listed</div>
              <div className="dm-kpi__value">{kpi.total}</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Linked to device</div>
              <div className="dm-kpi__value">{kpi.linked}</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">MQTT</div>
              <div className="dm-kpi__value">{kpi.mqtt}</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Sites</div>
              <div className="dm-kpi__value">{sites.length}</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Devices (site)</div>
              <div className="dm-kpi__value">{devicesLoading ? "…" : linkableDevices.length}</div>
            </div>
          </div>
        </OpsKpiRow>

        <OpsFilterPanel ariaLabel="Endpoint filters">
          <form className="dm-controls-form" onSubmit={onFilterSearch}>
            <div className="dm-controls-form__row">
              <OpsScopeControls variant="filters" timeRangeLabel="Range" />
              <div className="dm-search-wrap">
                <Search size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                <input
                  id="ingest-q"
                  className="dm-search-input"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search name…"
                  aria-label="Search endpoints"
                />
              </div>
              <div className="dm-filter-field">
                <label htmlFor="ingest-f-proto">Protocol</label>
                <select id="ingest-f-proto" value={filterProtocol} onChange={(e) => setFilterProtocol(e.target.value)}>
                  <option value="all">All</option>
                  {V2_ENDPOINT_PROTOCOL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="dm-filter-field">
                <label htmlFor="ingest-f-life">Lifecycle</label>
                <select id="ingest-f-life" value={filterLifecycle} onChange={(e) => setFilterLifecycle(e.target.value)}>
                  {ENDPOINT_LIFECYCLE_FILTERS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="dm-btn dm-btn--primary dm-btn--search" disabled={loading}>
                Search
              </button>
            </div>
          </form>
        </OpsFilterPanel>

        <div className="ingest-ept-endpoints-table">
          {err ? <PageStatus variant="error">{err}</PageStatus> : null}
          {ok ? <PageStatus variant="success">{ok}</PageStatus> : null}

          <OpsDataTable id="v2-ingest-endpoints-table">
                {loading && filteredItems.length === 0 ? (
                  <p className="dm-empty">Loading…</p>
                ) : filteredItems.length === 0 ? (
                  <p className="dm-data-table__empty">No endpoints match the current filters.</p>
                ) : (
                  <div className="dm-device-table-shell">
                    <div className="dm-table-scroll">
                      <table className="dm-data-table">
                        <thead>
                          <tr>
                            <th className="dm-data-table__th" scope="col">
                              Name
                            </th>
                            <th className="dm-data-table__th" scope="col">
                              Protocol
                            </th>
                            <th className="dm-data-table__th" scope="col">
                              Stream key
                            </th>
                            <th className="dm-data-table__th" scope="col">
                              Site
                            </th>
                            <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                              Lifecycle
                            </th>
                            <th className="dm-data-table__th" scope="col">
                              Linked device
                            </th>
                            <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                              Identity
                            </th>
                            <th className="dm-data-table__th dm-data-table__th--actions" scope="col">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageRows.map((ep) => {
                            const siteLabel = sitesById[ep.site_id] ?? `${ep.site_id.slice(0, 8)}…`;
                            const linked =
                              ep.device_endpoint_id && deviceEndpointIdToDeviceName.get(ep.device_endpoint_id);
                            return (
                              <tr key={ep.id} className="dm-data-table__row">
                                <td className="dm-data-table__td">
                                  <span className="dm-name-link" style={{ cursor: "default" }}>
                                    {ep.endpoint_name}
                                  </span>
                                </td>
                                <td className="dm-data-table__td">{protocolLabelForTable(ep.protocol)}</td>
                                <td className="dm-data-table__td">
                                  <code>{ep.object_name}</code>
                                </td>
                                <td className="dm-data-table__td">
                                  <small>{siteLabel}</small>
                                </td>
                                <td className="dm-data-table__td dm-data-table__td--center">
                                  <OpsStatusPill
                                    status={ep.lifecycle_status?.trim() ? ep.lifecycle_status : "—"}
                                    variant={lifecyclePillVariant(ep.lifecycle_status)}
                                  />
                                </td>
                                <td className="dm-data-table__td">
                                  {linked ? <span>{linked}</span> : <span className="dash-widget__muted">—</span>}
                                </td>
                                <td className="dm-data-table__td dm-data-table__td--center">
                                  <button
                                    type="button"
                                    className="dm-name-link"
                                    style={{
                                      background: "none",
                                      border: "none",
                                      padding: 0,
                                      cursor: "pointer",
                                      font: "inherit",
                                      color: "var(--color-accent, #4da3ff)",
                                      textDecoration: "underline",
                                    }}
                                    onClick={() => {
                                      setIdentityModalId(ep.id);
                                      setSearchParams(
                                        (prev) => {
                                          const n = new URLSearchParams(prev);
                                          n.set("identity", ep.id);
                                          return n;
                                        },
                                        { replace: true },
                                      );
                                    }}
                                  >
                                    <GitBranch size={14} strokeWidth={2} aria-hidden style={{ verticalAlign: "middle", marginRight: 4 }} />
                                    Map identity
                                  </button>
                                </td>
                                <td className="dm-data-table__td dm-data-table__td--actions">
                                  <div className="dm-act-grid">
                                    <OpsActionButton type="button" title="Edit endpoint" aria-label={`Edit ${ep.endpoint_name}`} onClick={() => startEdit(ep)}>
                                      <Pencil size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                                    </OpsActionButton>
                                    <OpsActionButton
                                      type="button"
                                      title="View scrubbed events and payload samples (Timescale)"
                                      aria-label={`Scrubbed events for ${ep.endpoint_name}`}
                                      onClick={() => openScrubbedEventsModal(ep)}
                                    >
                                      <Braces size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                                    </OpsActionButton>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </OpsDataTable>
              {filteredItems.length > PAGE_SIZE ? (
                <div className="ingest-ept-pagination">
                  <span>
                    Page {safePage + 1} / {pageCount} · {filteredItems.length} endpoints
                  </span>
                  <OpsActionButton type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage <= 0} title="Previous page">
                    <ChevronLeft size={16} aria-hidden />
                  </OpsActionButton>
                  <OpsActionButton
                    type="button"
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={safePage >= pageCount - 1}
                    title="Next page"
                  >
                    <ChevronRight size={16} aria-hidden />
                  </OpsActionButton>
                </div>
              ) : null}
        </div>

        <AppModalShell
          open={lineageModalOpen}
          title="Device lineage"
          titleId="ingest-lineage-modal-title"
          subtitle="Trace how data flows from devices through ingest and downstream systems."
          onClose={() => setLineageModalOpen(false)}
          size="lg"
        >
          <p className="dash-widget__muted" style={{ margin: 0, lineHeight: 1.5 }}>
            Lineage visualization is not available yet. This dialog will show version history, endpoint links, and
            related context for the current scope.
          </p>
        </AppModalShell>

        <AppModalShell
          open={endpointModalOpen}
          title={editing ? "Edit endpoint" : "Create endpoint"}
          titleId="ingest-endpoint-modal-title"
          onClose={() => {
            resetForm();
            setEndpointModalOpen(false);
          }}
          size="lg"
          dialogClassName="ingest-ept-endpoint-dialog"
        >
          {endpointForm}
        </AppModalShell>

        <AppModalShell
          open={Boolean(identityModalId)}
          title="Endpoint identity"
          titleId="ingest-identity-modal-title"
          onClose={closeIdentityModal}
          size="lg"
        >
          {identityModalId ? <EndpointIdentityPanel embedded endpointId={identityModalId} /> : null}
        </AppModalShell>

        <ScrubbedEventsSelectModal
          open={scrubbedModalOpen && Boolean(scrubbedEndpointId)}
          onClose={closeScrubbedEventsModal}
          endpointId={scrubbedEndpointId}
          deviceName={scrubbedEndpointLabel}
        />
      </div>
    </PageShell>
  );
}
