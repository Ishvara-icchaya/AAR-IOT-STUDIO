import { LogOut } from "lucide-react";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { AdminDropdown } from "./AdminDropdown";
import { UserMenu } from "./UserMenu";
import { useSitePermissionsOptional } from "@/contexts/SitePermissionsContext";
import { titleFromPath, userIsAdmin } from "./navigation";
import { useShellMessage } from "./ShellMessageContext";

const APP_VERSION = "8.0.0";

export function FooterBar() {
  const env = import.meta.env.MODE === "production" ? "production" : "development";
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const showAdmin = userIsAdmin(me?.role, me?.is_superuser);
  const sitePerms = useSitePermissionsOptional();
  const showSiteAccessMenu =
    sitePerms &&
    !sitePerms.loading &&
    (sitePerms.hasUnion("users.read") ||
      sitePerms.hasUnion("users.invite") ||
      sitePerms.hasUnion("users.assign_roles"));
  const showAdminMenu = showAdmin || Boolean(showSiteAccessMenu);
  const { messages, clearMessages } = useShellMessage();
  const pageLabel = titleFromPath(location.pathname);
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    const p = location.pathname;
    if (prevPathRef.current !== null && prevPathRef.current !== p) {
      clearMessages();
    }
    prevPathRef.current = p;
  }, [location.pathname, clearMessages]);

  return (
    <footer className="shell-footer" role="contentinfo">
      <div className="shell-footer__row shell-footer__row--split">
        <div className="shell-footer__messages-col">
          {messages.length > 0 ? (
            <div className="shell-messages-panel" role="region" aria-label="Messages">
              {messages.map((m) => (
                <div key={m.id} className={`shell-message shell-message--${m.tone}`} role="status">
                  <span className="shell-message__text">{m.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="shell-footer__page-context" role="status" aria-label="Current page">
              <span className="shell-footer__page-context-title">{pageLabel}</span>
              <span className="shell-footer__page-context-path" title={location.pathname}>
                {location.pathname}
              </span>
            </div>
          )}
        </div>
        <div className="shell-footer__toolbar" aria-label="Session">
          {showAdminMenu ? <AdminDropdown iconOnly /> : null}
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
