import type { PlatformPortsConfigDTO } from "@/types/portsConfig";

type Props = {
  value: PlatformPortsConfigDTO;
  onChange: (p: Partial<PlatformPortsConfigDTO>) => void;
};

export function PortsAccessSettingsPanel({ value, onChange }: Props) {
  return (
    <section className="admin-panel">
      <h2 className="admin-panel__title">Access behavior</h2>
      <label className="admin-check">
        <input
          type="checkbox"
          checked={value.allow_external_access}
          onChange={(e) => onChange({ allow_external_access: e.target.checked })}
        />
        Allow external access
      </label>
      <label className="admin-check">
        <input
          type="checkbox"
          checked={value.restrict_to_localhost}
          onChange={(e) => onChange({ restrict_to_localhost: e.target.checked })}
        />
        Restrict services to localhost
      </label>
      <label className="admin-check">
        <input
          type="checkbox"
          checked={value.enable_tls}
          disabled
          onChange={(e) => onChange({ enable_tls: e.target.checked })}
        />
        Enable TLS (not wired yet)
      </label>
    </section>
  );
}
