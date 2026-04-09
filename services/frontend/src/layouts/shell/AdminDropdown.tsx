import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ADMIN_NAV_ITEMS, isAdminSectionActive } from "./navigation";

export function AdminDropdown() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const adminActive = isAdminSectionActive(pathname);

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
        className={`shell-toolbar-btn shell-dropdown__trigger${open || adminActive ? " shell-dropdown__trigger--active" : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        Administration <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="shell-dropdown__panel shell-dropdown__panel--toolbar" role="menu">
          {ADMIN_NAV_ITEMS.map((item) => (
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
