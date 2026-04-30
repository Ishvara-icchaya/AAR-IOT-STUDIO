import { lazy, Suspense, useEffect, useState } from "react";
import { getMapObjectDetail } from "@/api/dashboard";
import type { TrendScope, TrendPopupProps } from "@/types/trends";

const TrendPopup = lazy(() => import("./TrendPopup"));
const MapObjectKpiTrendPopup = lazy(() => import("./MapObjectKpiTrendPopup"));

type Props = {
  siteId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  /** When set, skip fetch and show this message only */
  blockedMessage?: string;
  /** Passed to map detail API for LDS trend_context (cluster → endpoint). */
  trendScope?: "resolved_device" | "endpoint" | "site";
};

function healthBadgeClass(status: string | undefined): string {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "green") return "dash-map-popup__badge dash-map-popup__badge--green";
  if (s === "yellow") return "dash-map-popup__badge dash-map-popup__badge--yellow";
  if (s === "red") return "dash-map-popup__badge dash-map-popup__badge--red";
  if (s === "offline") return "dash-map-popup__badge dash-map-popup__badge--offline";
  return "dash-map-popup__badge dash-map-popup__badge--neutral";
}

export function MapMarkerPopupRoot(props: Props) {
  const { siteId, sourceType, sourceId, title, blockedMessage, trendScope } = props;
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!blockedMessage);

  useEffect(() => {
    if (blockedMessage) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        const r = await getMapObjectDetail({ siteId, sourceType, sourceId, trendScope });
        if (!cancelled) {
          setDetail((r?.detail as Record<string, unknown>) ?? null);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Failed to load detail");
          setDetail(null);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId, sourceType, sourceId, blockedMessage, trendScope]);

  if (blockedMessage) {
    return (
      <div className="dash-map-popup dash-map-popup--bare">
        <div className="dash-map-popup__head">
          <span className="dash-map-popup__title">{title}</span>
        </div>
        <p className="dash-map-popup__msg">{blockedMessage}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="dash-map-popup">
        <div className="dash-map-popup__loading">
          <div className="dash-map-popup__head">
            <span className="dash-map-popup__title">{title}</span>
          </div>
          <p className="dash-map-popup__hint">Loading asset details…</p>
        </div>
      </div>
    );
  }

  if (err || !detail) {
    return (
      <div className="dash-map-popup">
        <div className="dash-map-popup__head">
          <span className="dash-map-popup__title">{title}</span>
        </div>
        <p className="dash-map-popup__msg">{err ?? "No detail available."}</p>
      </div>
    );
  }

  const h = (detail.health as Record<string, unknown> | undefined) || {};
  const kl = (detail.kpi_latest as Record<string, unknown> | undefined) || {};
  const df = (detail.display_fields as Record<string, unknown> | undefined) || {};
  const tc = (detail.trend_context ?? (detail as { trendContext?: unknown }).trendContext) as
    | Record<string, unknown>
    | undefined;
  const hs = h.health_status as string | undefined;

  const trendProps: (TrendPopupProps & { siteId: string }) | null = (() => {
    if (!tc || typeof tc.entityId !== "string" || typeof tc.scope !== "string") return null;
    const metricKeys = Array.isArray(tc.metricKeys)
      ? tc.metricKeys.filter((x): x is string => typeof x === "string")
      : [];
    const p: TrendPopupProps = {
      scope: tc.scope as TrendScope,
      entityId: tc.entityId,
      title,
      metricKeys,
      defaultWindow: "1h",
    };
    if (!["resolved_device", "endpoint", "site"].includes(p.scope)) return null;
    return { ...p, siteId };
  })();

  const objectTimescaleTrendKeys: string[] | null = (() => {
    if (!tc || tc.mode !== "map_object_timescale") return null;
    const mks = Array.isArray(tc.metricKeys)
      ? tc.metricKeys.filter((x): x is string => typeof x === "string")
      : [];
    return mks.length ? mks : null;
  })();

  return (
    <div className="dash-map-popup">
      <div className="dash-map-popup__head">
        <span className="dash-map-popup__title">{title}</span>
        {hs ? <span className={healthBadgeClass(hs)}>{hs}</span> : null}
      </div>
      {typeof h.health_message === "string" && h.health_message ? (
        <p className="dash-map-popup__msg">{h.health_message}</p>
      ) : null}

      {Object.keys(df).length > 0 ? (
        <div className="dash-map-popup__section">
          <div className="dash-map-popup__section-title">Display</div>
          <table className="dash-map-popup__table">
            <tbody>
              {Object.entries(df)
                .slice(0, 12)
                .map(([k, v]) => (
                  <tr key={k}>
                    <th scope="row">{k}</th>
                    <td>{v === null || v === undefined ? "—" : String(v)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {Object.keys(kl).length > 0 ? (
        <div className="dash-map-popup__section">
          <div className="dash-map-popup__section-title">KPI (latest)</div>
          <table className="dash-map-popup__table">
            <tbody>
              {Object.entries(kl)
                .slice(0, 12)
                .map(([k, v]) => (
                  <tr key={k}>
                    <th scope="row">{k}</th>
                    <td>{v === null || v === undefined ? "—" : String(v)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {trendProps ? (
        <Suspense
          fallback={<p className="dash-map-popup__hint">Loading trends…</p>}
        >
          <TrendPopup {...trendProps} />
        </Suspense>
      ) : null}

      {objectTimescaleTrendKeys && detail ? (
        <Suspense
          fallback={<p className="dash-map-popup__hint">Loading KPI history…</p>}
        >
          <MapObjectKpiTrendPopup detail={detail} metricKeys={objectTimescaleTrendKeys} />
        </Suspense>
      ) : null}

      <p className="dash-map-popup__footer">Runtime detail</p>
    </div>
  );
}
