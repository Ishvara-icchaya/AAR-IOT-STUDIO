import { useMemo } from "react";
import type { AIChatResponse } from "@/types/ai";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";

type DynamicRow = { _rowIndex: number } & Record<string, unknown>;

export function AiResultsTable({ res }: { res: AIChatResponse | null }) {
  const sample = res?.results?.sample_rows;
  const keys = useMemo(() => {
    if (!Array.isArray(sample) || sample.length === 0) return [] as string[];
    return Array.from(new Set(sample.flatMap((r) => (r && typeof r === "object" ? Object.keys(r as object) : []))));
  }, [sample]);

  const rowData = useMemo((): DynamicRow[] => {
    if (!Array.isArray(sample) || sample.length === 0) return [];
    return sample.map((row, i) => {
      const o = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
      const flat: DynamicRow = { _rowIndex: i };
      for (const k of keys) {
        flat[k] = o[k];
      }
      return flat;
    });
  }, [sample, keys]);

  const columns = useMemo<PlainOperationalColumn<DynamicRow>[]>(() => {
    return keys.map((k) => ({
      id: k,
      header: k,
      cell: (r) => formatCell(r[k]),
    }));
  }, [keys]);

  if (!Array.isArray(sample) || sample.length === 0) {
    return <p style={{ color: "var(--color-text-muted)" }}>No tabular sample rows for this answer.</p>;
  }

  return (
    <PlainOperationalTable<DynamicRow>
      rows={rowData}
      columns={columns}
      getRowId={(r) => String(r._rowIndex)}
      maxHeight="min(60vh, 520px)"
      bordered
    />
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 200);
  return String(v);
}
