export function PortsConfigBanner() {
  return (
    <div className="ports-config-banner" role="note">
      <span className="ports-badge ports-badge--muted">Runtime-managed</span>
      <span className="ports-badge ports-badge--muted">Compose-controlled</span>
      <span className="ports-badge ports-badge--warn">Restart required</span>
      <p className="ports-config-banner__text">
        Phase 1 stores logical endpoints and publish defaults in the database. Changing values here does not rebind
        Docker ports or restart containers — apply matching changes in Compose/host networking, then restart services
        if needed.
      </p>
    </div>
  );
}
