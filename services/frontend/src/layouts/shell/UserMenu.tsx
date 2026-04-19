import { CircleUser } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/AuthContext";

export function UserMenu({ iconOnly }: { iconOnly?: boolean }) {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const label = me?.email?.split("@")[0] || me?.email || "User";
  const tip = me?.email ? `Account — ${me.email}` : "Account menu";

  return (
    <div className="shell-dropdown shell-dropdown--toolbar" ref={rootRef}>
      <button
        type="button"
        className={`shell-toolbar-btn shell-dropdown__trigger${iconOnly ? " shell-dropdown__trigger--icon" : ""}${open ? " shell-dropdown__trigger--active" : ""}`}
        aria-expanded={open}
        aria-haspopup="true"
        title={tip}
        aria-label={tip}
        onClick={() => setOpen((o) => !o)}
      >
        {iconOnly ? (
          <CircleUser size={18} strokeWidth={2} aria-hidden />
        ) : (
          <>
            <span className="shell-user-menu__name">{label}</span>
            {me?.role ? (
              <span className="shell-user-menu__role" title={me.role}>
                {me.role}
              </span>
            ) : null}
            <span aria-hidden>▾</span>
          </>
        )}
      </button>
      {open ? (
        <div className="shell-dropdown__panel shell-dropdown__panel--toolbar shell-user-menu__panel" role="menu">
          <div className="shell-dropdown__row shell-dropdown__row--muted" role="menuitem">
            Profile <span className="shell-tag-soon">soon</span>
          </div>
          <div className="shell-dropdown__row shell-dropdown__row--muted" role="menuitem">
            {me?.email}
          </div>
        </div>
      ) : null}
    </div>
  );
}
