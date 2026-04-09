import type { CSSProperties } from "react";
import type { PlatformPortDTO } from "@/types/portsConfig";

const inp: CSSProperties = {
  padding: "0.35rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  width: "100%",
  minWidth: "4rem",
};

type Props = {
  ports: PlatformPortDTO[];
  onChange: (ports: PlatformPortDTO[]) => void;
};

export function PortsTable({ ports, onChange }: Props) {
  function update(i: number, patch: Partial<PlatformPortDTO>) {
    const next = ports.map((p, j) => (j === i ? { ...p, ...patch } : p));
    onChange(next);
  }

  return (
    <section className="admin-panel">
      <h2 className="admin-panel__title">Service endpoints</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Protocol</th>
              <th>Host</th>
              <th>Port</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {ports.map((p, i) => (
              <tr key={p.id}>
                <td>{p.service_name}</td>
                <td>
                  <input
                    style={inp}
                    value={p.protocol}
                    onChange={(e) => update(i, { protocol: e.target.value })}
                  />
                </td>
                <td>
                  <input style={inp} value={p.host} onChange={(e) => update(i, { host: e.target.value })} />
                </td>
                <td>
                  <input
                    type="number"
                    style={inp}
                    min={1}
                    max={65535}
                    value={p.port}
                    onChange={(e) =>
                      update(i, { port: Math.min(65535, Math.max(1, parseInt(e.target.value, 10) || 1)) })
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={(e) => update(i, { enabled: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
