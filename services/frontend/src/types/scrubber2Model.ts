/** Scrubber 2.0 internal pipeline model (round-tripped under `mapping.scrubber2`). */

export const SCRUBBER2_SEMANTIC_ROLES = [
  "identity",
  "metric",
  "display",
  "filter",
  "grouping",
  "timestamp",
  "health",
  "geo",
] as const;

export type Scrubber2SemanticRole = (typeof SCRUBBER2_SEMANTIC_ROLES)[number];

export type Scrubber2AttributeRow = {
  key: string;
  mode: "literal" | "copy";
  value?: unknown;
  sourcePath?: string;
  type?: string;
};

export type Scrubber2HealthMode = "incoming_field" | "simple_rules" | "threshold_reference_json";

export type Scrubber2Model = {
  keepFields: string[];
  /** Optional per-path notes shown in Drop/Keep center table (not sent to engine). */
  fieldDescriptions: Record<string, string>;
  normalize: {
    flatten: boolean;
    /** Source path → output field name (serialized to legacy `scalarFields`). */
    renames: Array<{ from: string; to: string }>;
    typeCasts: Record<string, string>;
  };
  attributes: Scrubber2AttributeRow[];
  derived: {
    enabled: boolean;
    code: string;
    outputFields: string[];
  };
  fieldSemantics: Array<{
    path: string;
    label?: string;
    type: string;
    roles: string[];
    aiExposed?: boolean;
  }>;
  health: {
    mode: Scrubber2HealthMode;
    config: Record<string, unknown>;
  };
  kpi: {
    metrics: Array<{
      path: string;
      aggregation: string;
      window: string;
      rollup?: string;
    }>;
  };
  location: {
    latitudePath?: string;
    longitudePath?: string;
    altitudePath?: string;
    headingPath?: string;
  };
};

/** Persisted alongside `scrubberStudio` for round-trip UI state. */
export type Scrubber2PersistedBlob = {
  /** Legacy field from older saves; omitted on new writes. */
  pipelineVersion?: string;
  model: Scrubber2Model;
};

// TODO(scrubber2): Pipeline / mapping version UX when lifecycle is defined (semver, publish vs draft).

export function defaultScrubber2Model(): Scrubber2Model {
  return {
    keepFields: [],
    fieldDescriptions: {},
    normalize: { flatten: false, renames: [], typeCasts: {} },
    attributes: [{ key: "", mode: "literal", value: "" }],
    derived: {
      enabled: false,
      code:
        "def transform(payload):\n    # return a dict of scalar fields only\n    return {\n        \"example_derived\": 1,\n    }\n",
      outputFields: [],
    },
    fieldSemantics: [],
    health: {
      mode: "simple_rules",
      config: {
        default_status: "green",
        rules: [{ name: "rule1", condition: "", status: "yellow", priority: "50", code: "", message: "" }],
      },
    },
    kpi: { metrics: [] },
    location: {},
  };
}
