import type { Scrubber2FieldMeta } from "@/lib/scrubber2Fields";
import { AarButton } from "@/components/system/AarButton";

type Props = {
  rawJson: string;
  fields: Scrubber2FieldMeta[];
  fieldSearch: string;
  onFieldSearchChange: (v: string) => void;
  keepSet: Set<string>;
  onToggleField: (path: string, include: boolean) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  sampledLabel: string;
};

export function FieldExplorerPanel({
  rawJson,
  fields,
  fieldSearch,
  onFieldSearchChange,
  keepSet,
  onToggleField,
  onSelectAll,
  onClearAll,
  sampledLabel,
}: Props) {
  const q = fieldSearch.trim().toLowerCase();
  const rows = q ? fields.filter((f) => f.path.toLowerCase().includes(q) || f.type.toLowerCase().includes(q)) : fields;
  const selectedCount = fields.filter((f) => keepSet.has(f.path)).length;

  return (
    <div className="scrubber2-panel">
      <div className="scrubber2-panel__head">
        <h3 className="scrubber2-panel__title">Raw input</h3>
        <span className="scrubber2-toolbar" style={{ gap: "0.35rem" }}>
          <span className="scrubber2-live-dot" title="Live sample" />
          <span className="scrubber2-muted">{sampledLabel}</span>
        </span>
      </div>
      <div className="scrubber2-panel-body">
        <div className="scrubber2-muted" style={{ fontSize: "0.72rem" }}>
          Sample payload
        </div>
        <div className="scrubber2-code-scroll" style={{ maxHeight: "min(200px, 28vh)" }}>
          <pre>{rawJson || "—"}</pre>
        </div>
        <div className="scrubber2-toolbar">
          <input
            className="scrubber2-input"
            placeholder="Search fields…"
            value={fieldSearch}
            onChange={(e) => onFieldSearchChange(e.target.value)}
          />
        </div>
        <div className="scrubber2-toolbar" style={{ justifyContent: "space-between" }}>
          <span className="scrubber2-muted">
            {selectedCount} of {fields.length} selected
          </span>
          <span style={{ display: "flex", gap: "0.35rem" }}>
            <AarButton type="button" variant="outline" onClick={onSelectAll}>
              Select All
            </AarButton>
            <AarButton type="button" variant="outline" onClick={onClearAll}>
              Clear All
            </AarButton>
          </span>
        </div>
        <div className="scrubber2-table-scroll">
          <table className="scrubber2-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>✓</th>
                <th>Field</th>
                <th>Type</th>
                <th>Sample</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.path}>
                  <td>
                    <input
                      type="checkbox"
                      checked={keepSet.has(f.path)}
                      onChange={(e) => onToggleField(f.path, e.target.checked)}
                      aria-label={`Include ${f.path}`}
                    />
                  </td>
                  <td>
                    <code>{f.path}</code>
                  </td>
                  <td>{f.type}</td>
                  <td className="scrubber2-muted" style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {f.sample}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
