import type { PlatformPortDTO } from "@/types/portsConfig";

type Props = {
  ports: PlatformPortDTO[];
  onChange: (ports: PlatformPortDTO[]) => void;
};

export function PortsTable({ ports, onChange }: Props) {
  function update(i: number, patchRow: Partial<PlatformPortDTO>) {
    const next = ports.map((p, j) => (j === i ? { ...p, ...patchRow } : p));
    onChange(next);
  }

  return (
    <section className="admin-panel">
      <h2 className="admin-panel__title">Service endpoints</h2>
      <div className="dm-table-wrap">
        <div className="dm-device-table-shell">
          <div className="dm-table-scroll">
            <table className="dm-data-table">
              <thead>
                <tr>
                  <th className="dm-data-table__th" scope="col">
                    Service
                  </th>
                  <th className="dm-data-table__th" scope="col">
                    Protocol
                  </th>
                  <th className="dm-data-table__th" scope="col">
                    Host
                  </th>
                  <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                    Port
                  </th>
                  <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                    Enabled
                  </th>
                </tr>
              </thead>
              <tbody>
                {ports.map((p, i) => (
                  <tr key={p.id} className="dm-data-table__row">
                    <td className="dm-data-table__td">
                      <strong>{p.service_name}</strong>
                    </td>
                    <td className="dm-data-table__td">
                      <input
                        className="ports-config-inp"
                        value={p.protocol}
                        onChange={(e) => update(i, { protocol: e.target.value })}
                      />
                    </td>
                    <td className="dm-data-table__td">
                      <input className="ports-config-inp" value={p.host} onChange={(e) => update(i, { host: e.target.value })} />
                    </td>
                    <td className="dm-data-table__td dm-data-table__td--center">
                      <input
                        className="ports-config-inp"
                        type="number"
                        min={1}
                        max={65535}
                        value={p.port}
                        onChange={(e) =>
                          update(i, { port: Math.min(65535, Math.max(1, parseInt(e.target.value, 10) || 1)) })
                        }
                        style={{ maxWidth: "6rem" }}
                      />
                    </td>
                    <td className="dm-data-table__td dm-data-table__td--center">
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
        </div>
      </div>
    </section>
  );
}
