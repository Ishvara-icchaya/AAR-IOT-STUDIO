/** Aligns with GET/PUT /api/v1/workflows payloads. */

export type WorkflowStatus = "draft" | "validated" | "published" | "stopped" | "failed";

export type WorkflowNodeType =
  | "input"
  | "static"
  | "filter"
  | "formula"
  | "rename"
  | "drop"
  | "join"
  | "aggregate"
  | "health_mapping"
  | "kpi_builder"
  | "terminate";

export type WorkflowNodeDTO = {
  id: string;
  workflow_id: string;
  node_type: string;
  node_name: string;
  config_json: Record<string, unknown>;
  position_x: number;
  position_y: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowEdgeDTO = {
  id: string;
  workflow_id: string;
  source_node_id: string;
  target_node_id: string;
  created_at: string;
};

export type WorkflowReadDTO = {
  id: string;
  customer_id: string;
  site_id: string | null;
  name: string;
  description: string | null;
  lifecycle_status: string;
  version: number;
  is_published: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  nodes: WorkflowNodeDTO[];
  edges: WorkflowEdgeDTO[];
};

export type WorkflowListItemDTO = {
  id: string;
  site_id: string | null;
  name: string;
  lifecycle_status: string;
  version: number;
  is_published: boolean;
  updated_at: string;
  input_count: number;
  terminate_count: number;
};
