import { lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getMapObjectDetail } from "@/api/dashboard";
import type { TrendScope, TrendPopupProps } from "@/types/trends";
import { DashboardLiveContext } from "@/components/dashboard/DashboardLiveContext";

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
  /** Align detail KPI keys with dashboard map widget ``kpi_fields`` binding. */
  kpiKeys?: string[];
  /** Overrides context when this root is mounted in a MapLibre popup (outside DashboardLiveProvider). */
  detailRefreshIntervalSec?: number;
  detailRenderEpoch?: string;
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
  const {
    siteId,
    sourceType,
    sourceId,
    title,
    blockedMessage,
    trendScope,
    kpiKeys,
    detailRefreshIntervalSec: propRefreshSec,
    detailRenderEpoch: propEpoch,
  } = props;
  const liveCtx = useContext(DashboardLiveContext);
  const refreshIntervalSec = propRefreshSec ?? liveCtx?.refreshIntervalSec;
  const renderEpoch = propEpoch ?? liveCtx?.renderedAt;

  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!blockedMessage);

  const identityKey = useMemo(
    () =>
      `${siteId}|${sourceType}|${sourceId}|${trendScope ?? ""}|${JSON.stringify(kpiKeys ?? [])}`,
    [siteId, sourceType, sourceId, trendScope, kpiKeys],
  );

  const prevEpochRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (blockedMessage) return;
    let cancelled = false;
    const load = async (initial: boolean) => {
      if (initial) {
        setLoading(true);
        setErr(null);
      }
      try {
        const includeTimescaleHistory =
          sourceType === "data_object" || sourceType === "result_object";
        const r = await getMapObjectDetail({
          siteId,
          sourceType,
          sourceId,
          trendScope,
          kpiKeys,
          includeTimescaleHistory,
        });
        if (!cancelled) {
          setDetail((r?.detail as Record<string, unknown>) ?? null);
          if (initial) setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          if (initial) {
            setErr(e instanceof Error ? e.message : "Failed to load detail");
            setDetail(null);
            setLoading(false);
          }
        }
      }
    };
    void load(true);
    const sec =
      typeof refreshIntervalSec === "number" &&
      Number.isFinite(refreshIntervalSec) &&
      refreshIntervalSec >= 5
        ? refreshIntervalSec
        : undefined;
    const pollId =
      sec !== undefined ? window.setInterval(() => void load(false), sec * 1000) : undefined;
    return () => {
      cancelled = true;
      if (pollId !== undefined) window.clearInterval(pollId);
    };
  }, [identityKey, blockedMessage, refreshIntervalSec, siteId, sourceType, sourceId, trendScope, kpiKeys]);

  useEffect(() => {
    if (blockedMessage || renderEpoch === undefined) return;
    const prev = prevEpochRef.current;
    prevEpochRef.current = renderEpoch;
    if (prev === undefined) return;
    if (prev === renderEpoch) return;
    let cancelled = false;
    void (async () => {
      try {
        const includeTimescaleHistory =
          sourceType === "data_object" || sourceType === "result_object";
        const r = await getMapObjectDetail({
          siteId,
          sourceType,
          sourceId,
          trendScope,
          kpiKeys,
          includeTimescaleHistory,
        });
        if (!cancelled) setDetail((r?.detail as Record<string, unknown>) ?? null);
      } catch {
        /* keep existing detail */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [renderEpoch, siteId, sourceType, sourceId, blockedMessage, trendScope, kpiKeys]);

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
  const deviceDisplay =
    typeof detail.device_display_name === "string" && detail.device_display_name.trim()
      ? detail.device_display_name.trim()
      : null;
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
      {deviceDisplay ? (
        <p className="dash-map-popup__hint dash-map-popup__device-line">{deviceDisplay}</p>
      ) : null}
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
