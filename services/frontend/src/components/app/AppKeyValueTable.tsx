import type { ReactNode } from "react";

export function AppKeyValueTable({
  rows,
  ariaLabel,
  className,
}: {
  rows: { label: ReactNode; value: ReactNode }[];
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <table className={["app-kv-table", className].filter(Boolean).join(" ")} aria-label={ariaLabel}>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <th scope="row">{r.label}</th>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
