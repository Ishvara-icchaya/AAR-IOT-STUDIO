import type { IngestProtocol, RestIngressMode } from "@/lib/deviceEndpointConfig";

/** Monitoring → Services tab row `service_name` values for ingress paths. */
export type MonitoringIngressLink = {
  label: string;
  /** Matches monitoring API `service_name` (opens service detail drawer when linked). */
  service: string;
  hint?: string;
};

export function monitoringIngressLinks(
  protocol: IngestProtocol,
  restMode?: RestIngressMode,
): MonitoringIngressLink[] {
  switch (protocol) {
    case "mqtt":
      return [
        {
          label: "MQTT bridge",
          service: "worker-mqtt-bridge",
          hint: "Merges device topics into platform subscriptions",
        },
        { label: "MQTT broker", service: "mosquitto", hint: "When platform broker is enabled" },
      ];
    case "http": {
      const rows: MonitoringIngressLink[] = [
        { label: "REST ingest (API)", service: "rest-ingest", hint: "JWT POST /ingest/raw" },
      ];
      if (restMode === "polling") {
        rows.push({
          label: "REST poller",
          service: "rest-poller",
          hint: "Worker pulls upstream when polling mode is used",
        });
      }
      return rows;
    }
    case "coap":
      return [{ label: "CoAP listener", service: "coap-listener" }];
    case "websocket":
      return [{ label: "WebSocket ingest", service: "websocket-ingest" }];
    default:
      return [];
  }
}

export function monitoringOverviewHref(): string {
  return "/administration/monitoring?tab=overview";
}

export function monitoringServiceHref(serviceName: string): string {
  const q = new URLSearchParams({ tab: "services", service: serviceName });
  return `/administration/monitoring?${q.toString()}`;
}
