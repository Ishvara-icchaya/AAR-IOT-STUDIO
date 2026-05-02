import { useEffect, useState } from "react";
import * as dashApi from "@/api/dashboard";

type Props = {
  siteId: string | null;
  sourceType: "latest_device_state" | "result_object";
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
};

export function DashboardSourceSelector({ siteId, sourceType, value, onChange, disabled }: Props) {
  const [items, setItems] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!siteId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        if (sourceType === "latest_device_state") {
          const r = await dashApi.listDashboardLatestDeviceStateSources(siteId);
          if (cancelled) return;
          setItems(
            (r?.items ?? []).map((x) => {
              const friendly =
                (x.device_name && x.device_name.trim()) ||
                (x.device_label && x.device_label.trim()) ||
                (x.endpoint_name && x.endpoint_name.trim()) ||
                "";
              const tail = `${x.object_name} · ${x.id.slice(0, 8)}…`;
              const label = friendly ? `${friendly} — ${tail}` : tail;
              return { id: x.id, label };
            }),
          );
        } else {
          const r = await dashApi.listDashboardResultObjectSources(siteId);
          if (cancelled) return;
          setItems(
            (r?.items ?? []).map((x) => ({
              id: x.id,
              label: `${x.result_object_name} (${x.id.slice(0, 8)}…)`,
            })),
          );
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId, sourceType]);

  if (!siteId) {
    return <p className="dash-widget__muted">Select a dashboard site to load sources.</p>;
  }

  return (
    <label className="dash-drawer__label">
      Source ({sourceType.replace("_", " ")})
      <select
        className="dash-drawer__input"
        value={value}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Select —</option>
        {items.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </select>
    </label>
  );
}
