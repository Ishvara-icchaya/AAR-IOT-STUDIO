export type TrendScope = "resolved_device" | "endpoint" | "site";

export type TrendPopupProps = {
  scope: TrendScope;
  entityId: string;
  title: string;
  metricKeys: string[];
  defaultWindow: "1h" | "24h";
  asOf?: string;
};

export type TrendBucketPointDTO = {
  ts: string;
  avg?: number | null;
  min?: number | null;
  max?: number | null;
  stddev?: number | null;
  n?: number | null;
  is_partial?: boolean;
};

export type TrendsWindowResponseDTO = {
  scope: TrendScope;
  entityId: string;
  window: "1h" | "24h";
  bucket: "5m";
  as_of: string;
  series: Record<string, TrendBucketPointDTO[]>;
};
