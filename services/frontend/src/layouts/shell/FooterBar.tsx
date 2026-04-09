import { NavLink } from "react-router-dom";

const FOOTER_LINKS: { label: string; to: string }[] = [
  { label: "Ingest", to: "/devices/raw" },
  { label: "Scrubber", to: "/scrubber/data-objects" },
  { label: "Workflow", to: "/workflow/list" },
  { label: "Publish", to: "/published-services" },
  { label: "Dashboard", to: "/dashboard/list" },
  { label: "AI", to: "/enterprise-ai" },
  { label: "Monitoring", to: "/administration/monitoring" },
];

const APP_VERSION = "0.1.0";

export function FooterBar() {
  const env = import.meta.env.MODE === "production" ? "production" : "development";
  return (
    <footer className="shell-footer" role="contentinfo">
      <div className="shell-footer__row">
        <span className="shell-footer__label">Services:</span>
        <nav className="shell-footer__nav" aria-label="Service areas">
          {FOOTER_LINKS.map((l, i) => (
            <span key={l.to} className="shell-footer__sep-wrap">
              {i > 0 ? <span className="shell-footer__sep" aria-hidden> | </span> : null}
              <NavLink to={l.to} className="shell-footer__link">
                {l.label}
              </NavLink>
            </span>
          ))}
        </nav>
      </div>
      <div className="shell-footer__meta">
        <span>Version: v{APP_VERSION}</span>
        <span className="shell-footer__dot" aria-hidden>
          ·
        </span>
        <span>{env}</span>
      </div>
    </footer>
  );
}
