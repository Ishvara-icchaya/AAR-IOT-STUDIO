import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import { isApiHttpError, apiFetch } from "@/api/client";
import { listControlPlaneAuditEvents, type ControlPlaneAuditEventRead } from "@/api/controlPlaneAudit";
import { OpsDataTable } from "@/components/ops/OpsDataTable";
import { OpsFilterPanel } from "@/components/ops/OpsFilterPanel";
import { OpsKpiRow } from "@/components/ops/OpsKpiRow";
import { OpsPageHeader } from "@/components/ops/OpsPageHeader";
import { OpsScopeControls } from "@/components/ops/OpsScopeControls";
import { AarButton } from "@/components/system/AarButton";
import { useSitePermissionsOptional } from "@/contexts/SitePermissionsContext";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { PageShell } from "@/layouts/PageShell";
import { useShellMessage } from "@/layouts/shell/ShellMessageContext";
import { AppIcon, ICON_SIZES, ICON_STROKE_WIDTH } from "@/lib/appIcons";

import "./device-register-page.css";

type SiteRow = { id: string; name: string };

export function ControlPlaneAuditPage() {
  const { siteId: opsSiteId } = useOpsShell();
  const sitePerms = useSitePermissionsOptional();
  const { pushMessage } = useShellMessage();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [items, setItems] = useState<ControlPlaneAuditEventRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftActionText, setDraftActionText] = useState("");
  const [appliedActionText, setAppliedActionText] = useState("");

  const canRead = Boolean(sitePerms && !sitePerms.loading && sitePerms.hasUnion("audit.read"));

  useEffect(() => {
    void apiFetch<SiteRow[]>("/administration/sites")
      .then((d) => setSites(d ?? []))
      .catch(() => setSites([]));
  }, []);

  const load = useCallback(async () => {
    if (!canRead) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await listControlPlaneAuditEvents({
        site_id: opsSiteId?.trim() || undefined,
        action_type: appliedActionText.trim() || undefined,
        limit: 200,
      });
      setItems(res?.items ?? []);
    } catch (e) {
      pushMessage("error", isApiHttpError(e) ? e.message : "Failed to load audit events");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [canRead, opsSiteId, appliedActionText, pushMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  const sitesById = useMemo(() => Object.fromEntries(sites.map((s) => [s.id, s.name])), [sites]);

  const distinctActionTypes = useMemo(() => new Set(items.map((i) => i.action_type)).size, [items]);

  const canClearFilters = !!draftActionText.trim() || !!appliedActionText.trim();

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setAppliedActionText(draftActionText);
  };

  const clearFilters = () => {
    setDraftActionText("");
    setAppliedActionText("");
  };

  return (
    <PageShell variant="list" className="device-manage-page">
      <div className="dm-root">
        <OpsPageHeader
          title="Control plane audit"
          subtitle="Control-plane actions (OTA, device versions, simulations, overrides). Grant audit.read under Site Access."
          actions={
            <>
              <Link to="/administration/site-access" className="dm-btn dm-btn--outline">
                Site Access
              </Link>
              <AarButton
                variant="outline"
                className="device-register-page__refresh-btn"
                disabled={loading || !canRead}
                aria-busy={loading || undefined}
                onClick={() => void load()}
              >
                <span className={loading ? "device-register-page__refresh-icon device-register-page__refresh-icon--spin" : "device-register-page__refresh-icon"}>
                  <RefreshCw size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                </span>
                {loading ? "Refreshing…" : "Refresh list"}
              </AarButton>
            </>
          }
        />

        {!sitePerms?.loading && !canRead ? (
          <p className="dm-data-table__empty" role="status">
            You need the <code>audit.read</code> permission on at least one site (or a tenant role that includes it).
          </p>
        ) : null}

        {canRead ? (
          <>
            <OpsKpiRow ariaLabel="Audit summary" className="dm-kpi-row--equal-3">
              <div className="dm-kpi dm-kpi--with-deco">
                <div className="dm-kpi__body">
                  <div className="dm-kpi__label">
                    <AppIcon name="dashboard" size="card" className="dm-kpi__label-icon" aria-hidden />
                    Events loaded
                  </div>
                  <div className="dm-kpi__value">{items.length}</div>
                  <div className="dm-kpi__sub">Up to 200 most recent</div>
                </div>
                <div className="dm-kpi__deco dm-kpi__deco--muted" aria-hidden>
                  <AppIcon name="dashboard" size="card" aria-hidden />
                </div>
              </div>
              <div className="dm-kpi dm-kpi--with-deco">
                <div className="dm-kpi__body">
                  <div className="dm-kpi__label">
                    <AppIcon name="chart" size="card" className="dm-kpi__label-icon" aria-hidden />
                    Distinct actions
                  </div>
                  <div className="dm-kpi__value">{distinctActionTypes}</div>
                  <div className="dm-kpi__sub">In this result set</div>
                </div>
                <div className="dm-kpi__deco dm-kpi__deco--muted" aria-hidden>
                  <AppIcon name="chart" size="card" aria-hidden />
                </div>
              </div>
              <div className="dm-kpi dm-kpi--with-deco">
                <div className="dm-kpi__body">
                  <div className="dm-kpi__label">
                    <AppIcon name="device" size="card" className="dm-kpi__label-icon" aria-hidden />
                    Sites in scope
                  </div>
                  <div className="dm-kpi__value">{sites.length}</div>
                  <div className="dm-kpi__sub">Tenant directory</div>
                </div>
                <div className="dm-kpi__deco dm-kpi__deco--muted" aria-hidden>
                  <AppIcon name="device" size="card" aria-hidden />
                </div>
              </div>
            </OpsKpiRow>

            <OpsFilterPanel ariaLabel="Audit filters">
              <form className="dm-controls-form" onSubmit={onSearch}>
                <div className="dm-controls-form__row">
                  <OpsScopeControls variant="filters" timeRangeLabel="Range" />
                  <div className="dm-search-wrap">
                    <Search size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                    <input
                      id="cpa-action"
                      className="dm-search-input"
                      value={draftActionText}
                      onChange={(e) => setDraftActionText(e.target.value)}
                      placeholder="Action type (e.g. campaign_launched)"
                      maxLength={64}
                      aria-label="Filter by action type"
                    />
                  </div>
                  <button type="button" className="dm-clear-filters" disabled={!canClearFilters} onClick={clearFilters}>
                    Clear filters
                  </button>
                  <button type="submit" className="dm-btn dm-btn--primary dm-btn--search" disabled={loading}>
                    Search
                  </button>
                </div>
              </form>
            </OpsFilterPanel>

            <OpsDataTable id="control-plane-audit-table">
              {loading && items.length === 0 ? (
                <p className="dm-empty">Loading…</p>
              ) : items.length === 0 ? (
                <p className="dm-data-table__empty">No events match the current filters.</p>
              ) : (
                <div className="dm-device-table-shell" aria-busy={loading}>
                  {loading ? <p className="dm-table-loading">Updating list…</p> : null}
                  <div className="dm-table-scroll">
                    <table className="dm-data-table">
                      <thead>
                        <tr>
                          <th className="dm-data-table__th" scope="col">
                            When
                          </th>
                          <th className="dm-data-table__th" scope="col">
                            Action
                          </th>
                          <th className="dm-data-table__th" scope="col">
                            Resource
                          </th>
                          <th className="dm-data-table__th" scope="col">
                            Site
                          </th>
                          <th className="dm-data-table__th" scope="col">
                            Actor
                          </th>
                          <th className="dm-data-table__th" scope="col">
                            Payload
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((ev) => (
                          <tr key={ev.id} className="dm-data-table__row">
                            <td className="dm-data-table__td dm-data-table__td--muted">{new Date(ev.created_at).toLocaleString()}</td>
                            <td className="dm-data-table__td">
                              <code>{ev.action_type}</code>
                            </td>
                            <td className="dm-data-table__td">
                              <span className="dash-widget__muted">{ev.resource_type}</span>
                              {ev.resource_id ? (
                                <>
                                  {" "}
                                  <code>{ev.resource_id.slice(0, 8)}…</code>
                                </>
                              ) : null}
                            </td>
                            <td className="dm-data-table__td">
                              {ev.site_id ? (sitesById[ev.site_id] ?? ev.site_id.slice(0, 8) + "…") : "—"}
                            </td>
                            <td className="dm-data-table__td">{ev.actor_user_id ? <code>{ev.actor_user_id.slice(0, 8)}…</code> : "—"}</td>
                            <td className="dm-data-table__td" style={{ maxWidth: 280, fontSize: "0.8rem" }}>
                              {ev.payload_json ? (
                                <span className="dash-widget__muted" title={JSON.stringify(ev.payload_json)}>
                                  {JSON.stringify(ev.payload_json).slice(0, 120)}
                                  {JSON.stringify(ev.payload_json).length > 120 ? "…" : ""}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </OpsDataTable>
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
