import type { ReactNode } from "react";

export function AppSection({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={["app-section", className].filter(Boolean).join(" ")}>
      {title ? <h2 className="app-section__title">{title}</h2> : null}
      {description ? (
        typeof description === "string" ? (
          <p className="app-section__description">{description}</p>
        ) : (
          <div className="app-section__description">{description}</div>
        )
      ) : null}
      {children}
    </section>
  );
}
