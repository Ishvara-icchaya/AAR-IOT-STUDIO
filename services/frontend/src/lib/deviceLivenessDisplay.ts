import type { DeviceRead } from "@/api/devices";

const WAITING = "waiting_for_first_payload";
const ONLINE = "online";
const LATE = "late";
const OFFLINE = "offline";
const RECOVERED = "recovered";
const INACTIVE = "inactive";

const BADNESS: Record<string, number> = {
  [OFFLINE]: 4,
  [LATE]: 3,
  [WAITING]: 2,
  [RECOVERED]: 1,
  [ONLINE]: 0,
  [INACTIVE]: 4,
};

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Matches `workers/app/device_liveness.py` `_effective_last_seen`:
 * endpoint `last_payload_at` is source of truth; if an endpoint row exists but has no
 * payload timestamp yet, do not fall back to device-only `last_seen_at`.
 */
export function effectiveLastSeenMsForLiveness(d: DeviceRead): number | null {
  const ep = d.endpoint;
  const epSeen = parseIsoMs(ep?.last_payload_at ?? null);
  const devSeen = parseIsoMs(d.last_seen_at);
  if (ep != null && epSeen === null) {
    return null;
  }
  if (epSeen != null && devSeen != null) return Math.max(epSeen, devSeen);
  return epSeen ?? devSeen ?? null;
}

/**
 * Latest archived ingest for operators: endpoint payload timestamps, or device
 * `last_seen_at` when there is no endpoint row.
 */
export function lastDataReceivedMs(d: DeviceRead): number | null {
  const ep = d.endpoint;
  if (ep == null) {
    return parseIsoMs(d.last_seen_at);
  }
  const lastP = parseIsoMs(ep.last_payload_at);
  const firstP = parseIsoMs(ep.first_payload_at);
  if (lastP != null && firstP != null) return Math.max(lastP, firstP);
  return lastP ?? firstP ?? null;
}

/**
 * Same decision tree as `workers/app/device_liveness.py` `_target_state` (without
 * operational_status suppression — not exposed on DeviceRead).
 */
export function deriveLivenessStateFromTimestamps(d: DeviceRead): string {
  if (!d.is_active) return INACTIVE;
  if (d.endpoint != null && !d.endpoint.is_active) return INACTIVE;

  const seenMs = effectiveLastSeenMsForLiveness(d);
  if (seenMs === null) return WAITING;

  const ageSec = Math.max(0, (Date.now() - seenMs) / 1000);
  let lateThr = d.late_threshold_seconds;
  let offThr = d.offline_threshold_seconds;
  if (typeof lateThr !== "number" || !Number.isFinite(lateThr) || lateThr < 1) lateThr = 120;
  if (typeof offThr !== "number" || !Number.isFinite(offThr) || offThr < lateThr) {
    offThr = Math.max(lateThr, 300);
  }

  if (ageSec >= offThr) return OFFLINE;
  if (ageSec >= lateThr) return LATE;
  return ONLINE;
}

/**
 * Table / list liveness: blend timestamp-derived state with `current_liveness_state`
 * so inactive devices are not mislabeled as “waiting”, and the API can still win
 * for worse states (late/offline) when the worker has already transitioned.
 */
export function displayLivenessState(d: DeviceRead): string {
  const derived = deriveLivenessStateFromTimestamps(d);
  if (derived === INACTIVE) return INACTIVE;

  const raw = (d.current_liveness_state || "").trim().toLowerCase();
  if (raw === RECOVERED && derived === ONLINE) return RECOVERED;

  // Stale FSM: worker still “waiting” while we already have fresh ingest timestamps.
  if (raw === WAITING && derived === ONLINE) return ONLINE;

  if (!raw) return derived;

  const br = BADNESS[raw] ?? -1;
  const bd = BADNESS[derived] ?? -1;
  if (br > bd) return raw;
  return derived;
}
