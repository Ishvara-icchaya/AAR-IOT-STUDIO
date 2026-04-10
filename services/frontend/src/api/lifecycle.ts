/**
 * Thin helpers for GET …/dependencies and POST deactivate|reactivate|archive.
 * Paths are relative to `/api/v1` (see `apiFetch`).
 */
import { apiFetch } from "@/api/client";
import type { DependenciesListResponse } from "@/types/integrity";

type JsonRecord = Record<string, unknown>;

async function getDeps(path: string) {
  return apiFetch<DependenciesListResponse>(path);
}

async function postLifecycle(path: string) {
  return apiFetch<JsonRecord>(path, { method: "POST" });
}

/** Scrubber / compiled data objects */
export function getDataObjectDependencies(id: string) {
  return getDeps(`/scrubber/data-objects/${encodeURIComponent(id)}/dependencies`);
}
export function deactivateDataObject(id: string) {
  return postLifecycle(`/scrubber/data-objects/${encodeURIComponent(id)}/deactivate`);
}
export function reactivateDataObject(id: string) {
  return postLifecycle(`/scrubber/data-objects/${encodeURIComponent(id)}/reactivate`);
}
export function archiveDataObject(id: string) {
  return postLifecycle(`/scrubber/data-objects/${encodeURIComponent(id)}/archive`);
}

export function getWorkflowDependencies(id: string) {
  return getDeps(`/workflows/${encodeURIComponent(id)}/dependencies`);
}
export function deactivateWorkflow(id: string) {
  return postLifecycle(`/workflows/${encodeURIComponent(id)}/deactivate`);
}
export function reactivateWorkflow(id: string) {
  return postLifecycle(`/workflows/${encodeURIComponent(id)}/reactivate`);
}
export function archiveWorkflow(id: string) {
  return postLifecycle(`/workflows/${encodeURIComponent(id)}/archive`);
}

export function getDashboardDependencies(id: string) {
  return getDeps(`/dashboards/${encodeURIComponent(id)}/dependencies`);
}
export function deactivateDashboard(id: string) {
  return postLifecycle(`/dashboards/${encodeURIComponent(id)}/deactivate`);
}
export function reactivateDashboard(id: string) {
  return postLifecycle(`/dashboards/${encodeURIComponent(id)}/reactivate`);
}
export function archiveDashboard(id: string) {
  return postLifecycle(`/dashboards/${encodeURIComponent(id)}/archive`);
}

export function getDeviceDependencies(id: string) {
  return getDeps(`/devices/${encodeURIComponent(id)}/dependencies`);
}
export function deactivateDevice(id: string) {
  return postLifecycle(`/devices/${encodeURIComponent(id)}/deactivate`);
}
export function reactivateDevice(id: string) {
  return postLifecycle(`/devices/${encodeURIComponent(id)}/reactivate`);
}
export function archiveDevice(id: string) {
  return postLifecycle(`/devices/${encodeURIComponent(id)}/archive`);
}

export function getSiteDependencies(id: string) {
  return getDeps(`/administration/sites/${encodeURIComponent(id)}/dependencies`);
}
export function deactivateSite(id: string) {
  return postLifecycle(`/administration/sites/${encodeURIComponent(id)}/deactivate`);
}
export function reactivateSite(id: string) {
  return postLifecycle(`/administration/sites/${encodeURIComponent(id)}/reactivate`);
}
export function archiveSite(id: string) {
  return postLifecycle(`/administration/sites/${encodeURIComponent(id)}/archive`);
}

export function getPublishedServiceDependencies(id: string) {
  return getDeps(`/published-services/${encodeURIComponent(id)}/dependencies`);
}
export function deactivatePublishedService(id: string) {
  return postLifecycle(`/published-services/${encodeURIComponent(id)}/deactivate`);
}
export function reactivatePublishedService(id: string) {
  return postLifecycle(`/published-services/${encodeURIComponent(id)}/reactivate`);
}
export function archivePublishedService(id: string) {
  return postLifecycle(`/published-services/${encodeURIComponent(id)}/archive`);
}

export function getResultObjectDependencies(id: string) {
  return getDeps(`/result-objects/${encodeURIComponent(id)}/dependencies`);
}
export function deactivateResultObject(id: string) {
  return postLifecycle(`/result-objects/${encodeURIComponent(id)}/deactivate`);
}
export function reactivateResultObject(id: string) {
  return postLifecycle(`/result-objects/${encodeURIComponent(id)}/reactivate`);
}
export function archiveResultObject(id: string) {
  return postLifecycle(`/result-objects/${encodeURIComponent(id)}/archive`);
}
