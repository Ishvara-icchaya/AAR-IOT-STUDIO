import { Settings } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useSitePermissionsOptional } from "@/contexts/SitePermissionsContext";
import { ADMIN_NAV_ITEMS, isAdminSectionActive, userIsAdmin } from "./navigation";

export function AdminDropdown({ iconOnly }: { iconOnly?: boolean }) {
  const { me } = useAuth();
  const sitePerms = useSitePermissionsOptional();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const adminActive = isAdminSectionActive(pathname);
  const tenantAdmin = userIsAdmin(me?.role, me?.is_superuser);
  const navItems = useMemo(() => {
    const canSiteAccess =
      tenantAdmin ||
      Boolean(
        sitePerms &&
          !sitePerms.loading &&
          (sitePerms.hasUnion("users.read") ||
            sitePerms.hasUnion("users.invite") ||
            sitePerms.hasUnion("users.assign_roles")),
      );
    const canAudit =
      tenantAdmin ||
      Boolean(sitePerms && !sitePerms.loading && sitePerms.hasUnion("audit.read"));
    return ADMIN_NAV_ITEMS.filter((it) => {
      if (it.to === "/administration/site-access") return canSiteAccess;
      if (it.to === "/administration/audit") return canAudit;
      return tenantAdmin;
    });
  }, [tenantAdmin, sitePerms]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="shell-dropdown shell-dropdown--toolbar" ref={rootRef}>
      <button
        type="button"
        className={`shell-toolbar-btn shell-dropdown__trigger${iconOnly ? " shell-dropdown__trigger--icon" : ""}${open || adminActive ? " shell-dropdown__trigger--active" : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        title="Administration"
        aria-label="Administration"
        onClick={() => setOpen((o) => !o)}
      >
        {iconOnly ? (
          <Settings size={18} strokeWidth={2} aria-hidden />
        ) : (
          <>
            Administration <span aria-hidden>▾</span>
          </>
        )}
      </button>
      {open ? (
        <div className="shell-dropdown__panel shell-dropdown__panel--toolbar" role="menu">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              role="menuitem"
              to={item.to}
              className={({ isActive }) =>
                "shell-dropdown__row" + (isActive ? " shell-dropdown__row--active" : "")
              }
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}
