import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
};

export function OpsPageHeader({ title, subtitle, actions }: Props) {
  return (
    <header className="dm-page-hero">
      <div className="dm-page-hero__top">
        <div className="dm-page-hero__titles">
          <h1 className="dm-page-hero__title">{title}</h1>
          {subtitle ? <p className="dm-page-hero__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="dm-page-hero__actions">{actions}</div> : null}
      </div>
    </header>
  );
}
