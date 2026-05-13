import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, isApiHttpError } from "@/api/client";
import { listOtaCampaigns, type OtaCampaignRead } from "@/api/ota";
import { OpsStatusPill, type OpsVariant } from "@/components/ops/OpsStatusPill";
import { AarButton } from "@/components/system/AarButton";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { useSitePermissionsOptional } from "@/contexts/SitePermissionsContext";
import { useShellMessage } from "@/layouts/shell/ShellMessageContext";

import "@/pages/ota-campaigns-page.css";

type SiteRow = { id: string; name: string };

function statusVariant(s: string): OpsVariant {
  const x = (s || "").toLowerCase();
  if (x === "running" || x === "approved" || x === "completed") return "online";
  if (x === "failed" || x === "rolled_back") return "offline";
  if (x === "paused" || x === "pending_approval" || x === "queued") return "waiting";
  return "muted";
}

export type OtaCampaignsListPanelProps = {
  className?: string;
};

/** Campaign table + filters — use inside a page or `AppModalShell`. */
export function OtaCampaignsListPanel({ className }: OtaCampaignsListPanelProps) {
  const { siteId } = useOpsShell();
  const sitePerms = useSitePermissionsOptional();
  const { pushMessage } = useShellMessage();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [items, setItems] = useState<OtaCampaignRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  const effectiveSite = siteId ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listOtaCampaigns({
        site_id: effectiveSite || undefined,
        status: statusFilter.trim() || undefined,
      });
      setItems(res?.items ?? []);
    } catch (e) {
      pushMessage("error", isApiHttpError(e) ? e.message : "Failed to load campaigns");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveSite, statusFilter, pushMessage]);

  useEffect(() => {
    void apiFetch<SiteRow[]>("/administration/sites")
      .then((d) => setSites(d ?? []))
      .catch(() => setSites([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sitesById = useMemo(() => Object.fromEntries(sites.map((s) => [s.id, s.name])), [sites]);

  const canList = Boolean(sitePerms && !sitePerms.loading && sitePerms.hasUnion("ota.read"));

  return (
    <div className={["ota-campaigns-page", className].filter(Boolean).join(" ")}>
      <div className="ota-campaigns-page__toolbar">
        <label className="ota-campaigns-page__field">
          Status
          <input
            type="text"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            placeholder="e.g. running, draft"
          />
        </label>
        <AarButton type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          Refresh
        </AarButton>
      </div>
      <p className="ota-campaigns-page__sub">
        Optional: set the shell site scope to narrow the list to one site. Leave unset to see all campaigns you can read.
      </p>
      {!sitePerms?.loading && !canList ? (
        <p className="ota-campaigns-page__sub" role="status">
          You need <code>ota.read</code> on at least one site to view campaigns.
        </p>
      ) : null}
      {loading ? <p className="ota-campaigns-page__sub">Loading…</p> : null}
      {!loading && items.length === 0 ? (
        <p className="ota-campaigns-page__sub">No campaigns match the current filters.</p>
      ) : null}
      {!loading && items.length > 0 && canList ? (
        <div className="dm-table-scroll">
          <table className="dm-data-table">
            <thead>
              <tr>
                <th className="dm-data-table__th">Name</th>
                <th className="dm-data-table__th">Site</th>
                <th className="dm-data-table__th">Status</th>
                <th className="dm-data-table__th">Target firmware</th>
                <th className="dm-data-table__th">Created</th>
                <th className="dm-data-table__th dm-data-table__th--actions"> </th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="dm-data-table__row">
                  <td className="dm-data-table__td">
                    <Link className="dm-name-link" to={`/devices/ota/${encodeURIComponent(c.id)}`}>
                      {c.name}
                    </Link>
                  </td>
                  <td className="dm-data-table__td">
                    <small>{c.site_id ? sitesById[c.site_id] ?? c.site_id.slice(0, 8) + "…" : "—"}</small>
                  </td>
                  <td className="dm-data-table__td">
                    <OpsStatusPill status={c.status} variant={statusVariant(c.status)} />
                  </td>
                  <td className="dm-data-table__td">{c.target_firmware_version?.trim() || "—"}</td>
                  <td className="dm-data-table__td dm-data-table__td--muted">
                    {new Date(c.created_at).toLocaleString()}
                  </td>
                  <td className="dm-data-table__td dm-data-table__td--actions">
                    <Link className="dm-act-grid__btn" to={`/devices/ota/${encodeURIComponent(c.id)}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
