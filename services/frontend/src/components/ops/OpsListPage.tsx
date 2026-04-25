import type { ReactNode } from "react";
import { PageShell } from "@/layouts/PageShell";
import "./ops-list-page.css";

type Props = {
  className?: string;
  header: ReactNode;
  scopeBar?: ReactNode;
  kpiRow?: ReactNode;
  filterPanel?: ReactNode;
  content: ReactNode;
  pagination?: ReactNode;
  children?: ReactNode;
};

export function OpsListPage({ className, header, scopeBar, kpiRow, filterPanel, content, pagination, children }: Props) {
  return (
    <PageShell variant="list" className={className}>
      <div className="dm-root">
        {scopeBar ? <div className="ops-list-page__scope">{scopeBar}</div> : null}
        {header}
        {kpiRow ? <section className="ops-list-page__section">{kpiRow}</section> : null}
        {filterPanel ? <section className="ops-list-page__section">{filterPanel}</section> : null}
        {content}
        {pagination ? <div className="ops-list-page__pagination">{pagination}</div> : null}
        {children}
      </div>
    </PageShell>
  );
}
