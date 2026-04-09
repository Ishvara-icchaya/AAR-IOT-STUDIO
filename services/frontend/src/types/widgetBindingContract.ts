/** Frozen v1 widget binding — mirror of app/schemas/widget_binding_contract.py */

export type WidgetSourceTypeV1 = "data_object" | "result_object";

export type WidgetRepresentationV1 = "table" | "chart" | "kpi" | "map" | "device_tile";

export type FieldMappingEntryV1 = {
  source_path: string;
  target_key: string;
};

export type HealthBindingV1 = {
  status_path?: string | null;
  severity_path?: string | null;
  code_path?: string | null;
  message_path?: string | null;
};

export type KpiBindingEntryV1 = {
  value_path: string;
  key?: string | null;
  label?: string | null;
};

export type WidgetBindingV1 = {
  source_type: WidgetSourceTypeV1;
  source_id: string;
  representation: WidgetRepresentationV1;
  field_mapping: FieldMappingEntryV1[];
  health_binding?: HealthBindingV1 | null;
  kpi_binding: KpiBindingEntryV1[];
};
