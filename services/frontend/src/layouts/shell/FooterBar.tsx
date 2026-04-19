import { LogOut } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { AdminDropdown } from "./AdminDropdown";
import { AppearancePickers } from "./AppearancePickers";
import { UserMenu } from "./UserMenu";
import { userIsAdmin } from "./navigation";

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
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const showAdmin = userIsAdmin(me?.role, me?.is_superuser);

  return (
    <footer className="shell-footer" role="contentinfo">
      <div className="shell-footer__row shell-footer__row--split">
        <div className="shell-footer__left">
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
        <div className="shell-footer__toolbar" aria-label="Session and appearance">
          <AppearancePickers />
          {showAdmin ? <AdminDropdown iconOnly /> : null}
          <UserMenu iconOnly />
          <button
            type="button"
            className="shell-toolbar-btn shell-dropdown__trigger shell-dropdown__trigger--icon"
            title="Log out"
            aria-label="Log out"
            onClick={() => {
              logout();
              navigate("/login", { replace: true });
            }}
          >
            <LogOut size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>
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
