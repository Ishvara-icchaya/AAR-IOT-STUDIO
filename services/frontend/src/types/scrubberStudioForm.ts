/** Studio guided form — serializes to scrubberStudio.draft JSON. */

export type KpiMetricRow = {
  fieldPath: string;
  storeHistory: boolean;
  unit: string;
  label: string;
  win1h: boolean;
  win24h: boolean;
  type: string;
};

export type HealthRuleV2 = {
  name: string;
  condition: string;
  status: string;
  priority: string;
  code: string;
  message: string;
};

export type StudioDraftForm = {
  parseAs: "auto" | "json" | "text";
  objectName: string;
  selectPath: string;
  dropPathsText: string;
  flattenEnabled: boolean;
  flattenDelimiter: string;
  attrLiterals: { key: string; value: string }[];
  attrFromPayload: { key: string; path: string }[];
  scalarRows: { name: string; mode: "path" | "literal"; path: string; literal: string }[];
  functionBasedEnabled: boolean;
  functionBasedCode: string;
  functionBasedTimeoutMs: number;
  gpsEnabled: boolean;
  gpsSourceMode: "path" | "static";
  gpsLatitudePath: string;
  gpsLongitudePath: string;
  gpsStaticLatitude: string;
  gpsStaticLongitude: string;
  gpsAltitudePath: string;
  gpsHeadingPath: string;
  gpsSpeedPath: string;
  gpsTimestampPath: string;
  healthEngineMode: "map" | "rules";
  healthMapSourceField: string;
  healthMapPairs: { incoming: string; outStatus: string }[];
  healthMapMessageFrom: string;
  healthRulesDefault: string;
  healthRulesV2: HealthRuleV2[];
  healthDisplayEnabled: boolean;
  healthStatusKey: string;
  healthCodeKey: string;
  healthMessageKey: string;
  kpiDisplayFields: string[];
  kpiMetrics: KpiMetricRow[];
  /** When set, draft keeps pre–v4 health list until user edits the health step. */
  healthRawLegacy: unknown | null;
};
