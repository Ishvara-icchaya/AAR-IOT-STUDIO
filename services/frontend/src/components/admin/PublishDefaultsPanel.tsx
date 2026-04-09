import type { CSSProperties } from "react";
import type { PlatformPortsConfigDTO } from "@/types/portsConfig";

const inp: CSSProperties = {
  padding: "0.4rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  width: "100%",
  maxWidth: "16rem",
};

type Props = {
  value: PlatformPortsConfigDTO;
  onChange: (p: Partial<PlatformPortsConfigDTO>) => void;
};

export function PublishDefaultsPanel({ value, onChange }: Props) {
  return (
    <section className="admin-panel">
      <h2 className="admin-panel__title">Publishing defaults</h2>
      <div className="admin-grid-2">
        <label className="admin-field">
          Default REST publish host
          <input
            style={inp}
            value={value.default_rest_publish_host ?? ""}
            onChange={(e) => onChange({ default_rest_publish_host: e.target.value || null })}
          />
        </label>
        <label className="admin-field">
          Default REST publish port
          <input
            type="number"
            style={inp}
            min={1}
            max={65535}
            value={value.default_rest_publish_port ?? ""}
            onChange={(e) =>
              onChange({
                default_rest_publish_port: e.target.value
                  ? Math.min(65535, Math.max(1, parseInt(e.target.value, 10)))
                  : null,
              })
            }
          />
        </label>
        <label className="admin-field">
          Default MQTT publish host
          <input
            style={inp}
            value={value.default_mqtt_publish_host ?? ""}
            onChange={(e) => onChange({ default_mqtt_publish_host: e.target.value || null })}
          />
        </label>
        <label className="admin-field">
          Default MQTT publish port
          <input
            type="number"
            style={inp}
            min={1}
            max={65535}
            value={value.default_mqtt_publish_port ?? ""}
            onChange={(e) =>
              onChange({
                default_mqtt_publish_port: e.target.value
                  ? Math.min(65535, Math.max(1, parseInt(e.target.value, 10)))
                  : null,
              })
            }
          />
        </label>
      </div>
    </section>
  );
}
