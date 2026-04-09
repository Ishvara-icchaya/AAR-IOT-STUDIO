import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { activeMainSectionId, MAIN_NAV_GROUPS, type NavGroup } from "./navigation";

const HOVER_CLOSE_MS = 200;

export function MainNav({ mobileOpen, onNavigate }: { mobileOpen: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const sectionActive = activeMainSectionId(pathname);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [pinnedSection, setPinnedSection] = useState<string | null>(null);
  const pinRef = useRef<string | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    pinRef.current = pinnedSection;
  }, [pinnedSection]);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(
    (id: string) => {
      clearLeaveTimer();
      leaveTimerRef.current = setTimeout(() => {
        leaveTimerRef.current = null;
        setOpenSection((cur) => {
          if (cur !== id) return cur;
          if (pinRef.current === id) return cur;
          return null;
        });
      }, HOVER_CLOSE_MS);
    },
    [clearLeaveTimer],
  );

  const onEnterSection = useCallback(
    (id: string) => {
      clearLeaveTimer();
      setOpenSection(id);
    },
    [clearLeaveTimer],
  );

  const onLeaveSection = useCallback(
    (id: string) => {
      if (pinRef.current === id) return;
      scheduleClose(id);
    },
    [scheduleClose],
  );

  const onTogglePin = useCallback(
    (id: string) => {
      clearLeaveTimer();
      if (pinnedSection === id) {
        pinRef.current = null;
        setPinnedSection(null);
        setOpenSection(null);
      } else {
        pinRef.current = id;
        setPinnedSection(id);
        setOpenSection(id);
      }
    },
    [clearLeaveTimer, pinnedSection],
  );

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (!(t instanceof Node)) return;
      const inNav = (e.target as HTMLElement).closest?.("[data-main-nav-root]");
      if (!inNav) {
        setOpenSection(null);
        setPinnedSection(null);
        pinRef.current = null;
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenSection(null);
        setPinnedSection(null);
        pinRef.current = null;
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    return () => clearLeaveTimer();
  }, [clearLeaveTimer]);

  return (
    <nav
      id="shell-primary-nav"
      className={`shell-main-nav${mobileOpen ? " shell-main-nav--open" : ""}`}
      aria-label="Primary modules"
      data-main-nav-root
    >
      {MAIN_NAV_GROUPS.map((group) => (
        <NavModuleDropdown
          key={group.id}
          group={group}
          sectionActive={sectionActive === group.id}
          open={openSection === group.id}
          pinned={pinnedSection === group.id}
          onEnter={() => onEnterSection(group.id)}
          onLeave={() => onLeaveSection(group.id)}
          onTogglePin={() => onTogglePin(group.id)}
          onPick={() => {
            setOpenSection(null);
            setPinnedSection(null);
            pinRef.current = null;
            onNavigate?.();
          }}
        />
      ))}
    </nav>
  );
}

function NavModuleDropdown({
  group,
  sectionActive,
  open,
  pinned,
  onEnter,
  onLeave,
  onTogglePin,
  onPick,
}: {
  group: NavGroup;
  sectionActive: boolean;
  open: boolean;
  pinned: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onTogglePin: () => void;
  onPick: () => void;
}) {
  const show = open || pinned;

  return (
    <div
      className="shell-nav-module"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <button
        type="button"
        className={
          "shell-nav-module__trigger" +
          (sectionActive ? " shell-nav-module__trigger--section-active" : "") +
          (show ? " shell-nav-module__trigger--open" : "")
        }
        aria-expanded={show}
        aria-haspopup="true"
        onClick={(e) => {
          e.preventDefault();
          onTogglePin();
        }}
      >
        {group.label}
        <span className="shell-nav-module__caret" aria-hidden>
          ▾
        </span>
      </button>
      {show ? (
        <div className="shell-nav-module__panel" role="menu">
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              role="menuitem"
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                "shell-nav-module__link" + (isActive ? " shell-nav-module__link--active" : "")
              }
              onClick={onPick}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}
