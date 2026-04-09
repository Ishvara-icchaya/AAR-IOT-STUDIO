import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { blinkModeClass, healthColorVar } from "@/lib/healthBlink";

type RowIndicator = {
  health_status?: string;
  health_message?: string;
  blink_mode?: string;
};

export function TableWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const d = block.data ?? {};
  const rows = Array.isArray(d.rows) ? (d.rows as Record<string, unknown>[]) : [];
  const fieldsRaw = d.fields;
  const fields =
    Array.isArray(fieldsRaw) && fieldsRaw.length
      ? fieldsRaw.map(String)
      : rows[0]
        ? Object.keys(rows[0]).filter((k) => !k.startsWith("_"))
        : [];
  const indicators = Array.isArray(d.row_indicators) ? (d.row_indicators as RowIndicator[]) : [];

  return (
    <div className="dash-widget dash-widget--table">
      <h3 className="dash-widget__title">{block.title}</h3>
      <div className="dash-widget__table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              <th className="dash-table__health" aria-label="Health" />
              {fields.map((f) => (
                <th key={f}>{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={fields.length + 1} className="dash-widget__muted">
                  No rows
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const ind = indicators[i] ?? {};
                const blink = blinkModeClass(ind.blink_mode);
                const status = typeof ind.health_status === "string" ? ind.health_status : "";
                const chip = status ? status.toUpperCase() : "—";
                const msg = typeof ind.health_message === "string" ? ind.health_message : "";
                return (
                  <tr key={i} className="dash-table__data-row">
                    <td
                      className="dash-table__health"
                      style={{
                        borderLeft: `3px solid ${healthColorVar(status || undefined)}`,
                      }}
                    >
                      <div className="dash-table__health-cell">
                        <span
                          className={`dash-health-dot ${blink}`}
                          style={{
                            display: "inline-block",
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            background: healthColorVar(status || undefined),
                            flexShrink: 0,
                          }}
                          title={msg || status || "Health"}
                        />
                        <span
                          className="dash-health-chip"
                          style={{
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            padding: "0.1rem 0.35rem",
                            borderRadius: 4,
                            border: `1px solid ${healthColorVar(status || undefined)}`,
                            color: healthColorVar(status || undefined),
                            maxWidth: "5.5rem",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={msg || chip}
                        >
                          {chip}
                        </span>
                      </div>
                    </td>
                    {fields.map((f) => (
                      <td key={f}>{formatCell(row[f])}</td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
