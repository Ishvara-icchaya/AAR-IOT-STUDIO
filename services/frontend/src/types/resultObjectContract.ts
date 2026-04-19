/** Frozen v1 API shape: GET /api/v1/result-objects/{id} and workflow result-object lists. */

export type ResultObjectV1 = {
  id: string;
  workflow_id: string;
  terminate_node_id: string | null;
  result_object_name: string;
  site_id: string;
  customer_id: string;
  payload_json: Record<string, unknown>;
  health_status: string | null;
  created_at: string;
  latest_detail_id?: string | null;
  latest_seen_at?: string | null;
};
