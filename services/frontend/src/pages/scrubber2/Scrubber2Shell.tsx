import type { ReactNode } from "react";

export function Scrubber2Shell({ children }: { children: ReactNode }) {
  return (
    <div className="scrubber2-page page-card page-card--list device-manage-page">
      {children}
    </div>
  );
}
