import type { ReactNode } from "react";

type DeviceOpt = { id: string; name: string };

type Props = {
  devices: DeviceOpt[];
  deviceId: string;
  onDeviceChange: (id: string) => void;
  actions: ReactNode;
};

export function Scrubber2Header({ devices, deviceId, onDeviceChange, actions }: Props) {
  return (
    <header className="scrubber2-header scrubber2-header-bar">
      <div>
        <h1>Scrubber Studio 2.0</h1>
        <p className="scrubber2-sub">Build data pipelines that transform raw telemetry into trusted data.</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end" }}>
        <div className="scrubber2-selects">
          <label>
            Device
            <select value={deviceId} onChange={(e) => onDeviceChange(e.target.value)}>
              <option value="">Select device…</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="scrubber2-actions">{actions}</div>
      </div>
    </header>
  );
}
