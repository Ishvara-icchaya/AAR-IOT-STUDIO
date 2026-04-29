import { useEffect, useRef } from "react";

export function useDashboard2AutoRefresh({
  enabled,
  intervalSec,
  onTick,
}: {
  enabled: boolean;
  intervalSec: number;
  onTick: () => void;
}) {
  const cbRef = useRef(onTick);
  cbRef.current = onTick;

  useEffect(() => {
    if (!enabled) return;
    const intervalMs = Math.max(5, Math.min(3600, intervalSec)) * 1000;
    const t = window.setInterval(() => cbRef.current(), intervalMs);
    return () => window.clearInterval(t);
  }, [enabled, intervalSec]);
}
