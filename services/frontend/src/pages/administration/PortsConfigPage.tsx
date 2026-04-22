import { useCallback, useEffect, useState } from "react";
import { fetchPortsConfig, putPortsConfig, restartPortsServices, testPortsConfig } from "@/api/portsConfig";
import { PortsConfigBanner } from "@/components/admin/PortsConfigBanner";
import { PageShell } from "@/layouts/PageShell";
import { PortsAccessSettingsPanel } from "@/components/admin/PortsAccessSettingsPanel";
import { PortsActions } from "@/components/admin/PortsActions";
import { PortsTable } from "@/components/admin/PortsTable";
import { CanonicalIngressProductNotice } from "@/components/admin/CanonicalIngressProductNotice";
import { MqttIngestTelemetryPanel } from "@/components/admin/MqttIngestTelemetryPanel";
import { PublishDefaultsPanel } from "@/components/admin/PublishDefaultsPanel";
import { useShellMessage } from "@/layouts/shell";
import type { PlatformPortsConfigDTO, PlatformPortsConfigUpdateDTO } from "@/types/portsConfig";
import "../device-register-page.css";

function toUpdate(cfg: PlatformPortsConfigDTO): PlatformPortsConfigUpdateDTO {
  return {
    ports: cfg.ports.map((p) => ({
      service_name: p.service_name,
      protocol: p.protocol,
      host: p.host,
      port: p.port,
      enabled: p.enabled,
    })),
    default_rest_publish_host: cfg.default_rest_publish_host,
    default_rest_publish_port: cfg.default_rest_publish_port,
    default_mqtt_publish_host: cfg.default_mqtt_publish_host,
    default_mqtt_publish_port: cfg.default_mqtt_publish_port,
    mqtt_ingest: cfg.mqtt_ingest,
    allow_external_access: cfg.allow_external_access,
    restrict_to_localhost: cfg.restrict_to_localhost,
    enable_tls: cfg.enable_tls,
  };
}

export function PortsConfigPage() {
  const { pushMessage, clearMessages } = useShellMessage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [cfg, setCfg] = useState<PlatformPortsConfigDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetchPortsConfig();
      if (d) setCfg(d);
    } catch (e) {
      pushMessage("error", e instanceof Error ? e.message : "Failed to load ports config");
    } finally {
      setLoading(false);
    }
  }, [pushMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  function patch(p: Partial<PlatformPortsConfigDTO>) {
    setCfg((c) => (c ? { ...c, ...p } : c));
  }

  async function onSave() {
    if (!cfg) return;
    clearMessages();
    setSaving(true);
    try {
      const out = await putPortsConfig(toUpdate(cfg));
      if (out) setCfg(out);
      pushMessage("success", "Ports configuration saved.");
    } catch (e) {
      pushMessage("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    clearMessages();
    setTesting(true);
    try {
      const r = await testPortsConfig();
      if (r) {
        const lines = r.results
          .map((x) => `${x.service_name}: ${x.reachable ? "reachable" : "closed"} (${x.detail ?? "—"})`)
          .join("; ");
        pushMessage(r.success ? "info" : "warning", `${r.message} ${lines}`);
      }
    } catch (e) {
      pushMessage("error", e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  async function onRestart() {
    clearMessages();
    setRestarting(true);
    try {
      const r = await restartPortsServices();
      if (r) pushMessage("info", r.message);
    } catch (e) {
      pushMessage("error", e instanceof Error ? e.message : "Restart request failed");
    } finally {
      setRestarting(false);
    }
  }

  if (loading || !cfg) {
    return (
      <PageShell variant="list" className="ports-config-page device-manage-page">
        <div className="dm-root">
          <p className="dm-empty">Loading…</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell variant="list" className="ports-config-page device-manage-page">
      <div className="dm-root">
        <header className="dm-page-hero">
          <div className="dm-page-hero__top">
            <div className="dm-page-hero__titles">
              <h1 className="dm-sr-only">Configure Ports</h1>
              <p className="dm-page-hero__subtitle" style={{ marginTop: 0 }}>
                Logical service endpoints and publish defaults for this tenant (on-prem oriented).
              </p>
            </div>
          </div>
        </header>

        <PortsConfigBanner />
        <CanonicalIngressProductNotice />
        <PortsTable ports={cfg.ports} onChange={(ports) => patch({ ports })} />
        <MqttIngestTelemetryPanel value={cfg} onChange={patch} />
        <PublishDefaultsPanel value={cfg} onChange={patch} />
        <PortsAccessSettingsPanel value={cfg} onChange={patch} />
        <PortsActions
          saving={saving}
          testing={testing}
          restarting={restarting}
          onSave={onSave}
          onTest={onTest}
          onRestart={onRestart}
        />
      </div>
    </PageShell>
  );
}
