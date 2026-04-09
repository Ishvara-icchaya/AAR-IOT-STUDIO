import type { CSSProperties } from "react";
import type { PlatformPortsConfigDTO } from "@/types/portsConfig";

const panel: CSSProperties = {
  marginTop: "1.25rem",
  padding: "1rem",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  background: "var(--color-surface-elevated, var(--color-surface))",
};
const lbl: CSSProperties = { display: "block", fontSize: "0.8rem", color: "var(--color-text-muted)", marginBottom: "0.25rem" };
const inp: CSSProperties = {
  width: "100%",
  maxWidth: "320px",
  padding: "0.4rem 0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
};

export function MqttIngestTelemetryPanel({
  value,
  onChange,
}: {
  value: PlatformPortsConfigDTO;
  onChange: (p: Partial<PlatformPortsConfigDTO>) => void;
}) {
  const mi = value.mqtt_ingest;
  const dep = value.mqtt_ingest_deployment;

  return (
    <section style={panel}>
      <h2 style={{ fontSize: "1rem", marginTop: 0 }}>MQTT telemetry ingest</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", marginTop: 0 }}>
        Documents how sensors reach the platform. Ingest uses{" "}
        <strong>MinIO + raw_data_objects + Kafka raw.ingest</strong> (same as HTTP raw upload). The{" "}
        <code>worker-mqtt-bridge</code> subscriber connects using each device&apos;s saved MQTT endpoint (broker, auth,
        topic); optional <code>MQTT_TOPICS</code> in Compose uses the env broker only. Published-services MQTT is a
        separate outbound path.
      </p>

      <h3 style={{ fontSize: "0.9rem" }}>Deployment (read-only)</h3>
      <ul style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
        <li>
          <strong>Platform Mosquitto enabled:</strong> {dep.platform_broker_enabled ? "yes" : "no"}
        </li>
        <li>
          <strong>MQTT bridge deployed:</strong> {dep.mqtt_bridge_deployed ? "yes" : "no"}
        </li>
        <li>
          <strong>Broker listen / probe port:</strong> {dep.listen_port}
        </li>
        <li>
          <strong>API TCP probe host:</strong> <code>{dep.probe_host}</code>
        </li>
        {dep.sensor_connect_host_hint ? (
          <li>
            <strong>Sensor hostname hint:</strong> {dep.sensor_connect_host_hint}
          </li>
        ) : null}
      </ul>

      <h3 style={{ fontSize: "0.9rem" }}>Tenant defaults</h3>
      <div style={{ marginBottom: "0.75rem" }}>
        <span style={lbl}>Broker mode</span>
        <select
          value={mi.broker_mode}
          onChange={(e) =>
            onChange({
              mqtt_ingest: {
                ...mi,
                broker_mode: e.target.value as "internal" | "external",
              },
            })
          }
          style={inp}
        >
          <option value="internal">Internal (platform-hosted Mosquitto)</option>
          <option value="external">External broker</option>
        </select>
      </div>
      {mi.broker_mode === "external" ? (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <span style={lbl}>External broker host</span>
            <input
              style={inp}
              value={mi.external_broker_host ?? ""}
              placeholder="e.g. 192.168.1.50"
              onChange={(e) =>
                onChange({
                  mqtt_ingest: { ...mi, external_broker_host: e.target.value || null },
                })
              }
            />
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <span style={lbl}>External broker port</span>
            <input
              style={inp}
              type="number"
              min={1}
              max={65535}
              value={mi.external_broker_port ?? ""}
              placeholder="1883"
              onChange={(e) => {
                const v = e.target.value;
                onChange({
                  mqtt_ingest: {
                    ...mi,
                    external_broker_port: v === "" ? null : Number(v),
                  },
                });
              }}
            />
          </div>
        </>
      ) : null}
      <div style={{ marginBottom: "0.75rem" }}>
        <span style={lbl}>Default subscribe topic (documentation)</span>
        <input
          style={{ ...inp, maxWidth: "480px" }}
          value={mi.subscribe_topic ?? ""}
          placeholder="e.g. factory/line1/telemetry"
          onChange={(e) =>
            onChange({
              mqtt_ingest: { ...mi, subscribe_topic: e.target.value || null },
            })
          }
        />
      </div>
      <div style={{ marginBottom: 0 }}>
        <span style={lbl}>Default QoS (0–2)</span>
        <select
          value={String(mi.qos)}
          onChange={(e) =>
            onChange({
              mqtt_ingest: { ...mi, qos: Number(e.target.value) },
            })
          }
          style={inp}
        >
          <option value="0">0</option>
          <option value="1">1</option>
          <option value="2">2</option>
        </select>
      </div>
    </section>
  );
}
