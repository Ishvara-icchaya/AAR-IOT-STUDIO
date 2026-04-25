import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
};

export function AarPageHeader({ title, subtitle, actions }: Props) {
  return (
    <header className="aar-page-header">
      <div className="aar-page-header__row">
        <div>
          <h1 className="aar-page-header__title">{title}</h1>
          {subtitle ? <p className="aar-page-header__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="aar-page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}
