import { apiFetch } from "@/api/client";
import type {
  MonitoringAiPayload,
  MonitoringOverview,
  MonitoringQueueRow,
  MonitoringResourceRow,
  MonitoringServiceDetail,
  MonitoringServiceRow,
  MonitoringStorageRow,
} from "@/types/monitoring";

export type {
  MonitoringAiOps,
  MonitoringAiPayload,
  MonitoringAiServiceRow,
  MonitoringIncident,
  MonitoringOverview,
  MonitoringQueueRow,
  MonitoringResourceRow,
  MonitoringServiceAlertItem,
  MonitoringServiceDetail,
  MonitoringServiceRow,
  MonitoringStorageRow,
  MonitoringSummary,
} from "@/types/monitoring";

export function fetchMonitoringOverview() {
  return apiFetch<MonitoringOverview>("/monitoring/overview");
}

export function fetchMonitoringServices() {
  return apiFetch<MonitoringServiceRow[]>("/monitoring/services");
}

export function fetchMonitoringServiceDetail(serviceName: string) {
  return apiFetch<MonitoringServiceDetail>(`/monitoring/services/${encodeURIComponent(serviceName)}`);
}

export function fetchMonitoringQueues() {
  return apiFetch<MonitoringQueueRow[]>("/monitoring/queues");
}

export function fetchMonitoringResources() {
  return apiFetch<MonitoringResourceRow[]>("/monitoring/resources");
}

export function fetchMonitoringStorage() {
  return apiFetch<MonitoringStorageRow[]>("/monitoring/storage");
}

export function fetchMonitoringAi() {
  return apiFetch<MonitoringAiPayload>("/monitoring/ai");
}

/** Spec aliases (same as `fetchMonitoring*`). */
export const getMonitoringOverview = fetchMonitoringOverview;
export const getMonitoringServices = fetchMonitoringServices;
export const getMonitoringServiceDetail = fetchMonitoringServiceDetail;
export const getMonitoringQueues = fetchMonitoringQueues;
export const getMonitoringResources = fetchMonitoringResources;
export const getMonitoringStorage = fetchMonitoringStorage;
export const getMonitoringAi = fetchMonitoringAi;
