/** Aligns with backend `schemas/integrity.py` (resource_in_use, dependency lists). */

export type DependencyEntityType =
  | "workflow"
  | "dashboard"
  | "published_service"
  | "workflow_execution"
  | "raw_data_object"
  | "device"
  | "data_object"
  | "site"
  | "static_ingestion"
  | "user_site"
  | "device_endpoint"
  | "device_object"
  | "summary";

export type DependencyItem = {
  entity_type: DependencyEntityType;
  entity_id: string;
  label?: string | null;
  route_hint?: string | null;
};

export type ResourceInUseDetail = {
  error: "resource_in_use";
  message: string;
  dependencies: DependencyItem[];
  deactivate_url?: string | null;
  reactivate_url?: string | null;
  archive_url?: string | null;
};

export type DependenciesListResponse = {
  dependencies: DependencyItem[];
};
