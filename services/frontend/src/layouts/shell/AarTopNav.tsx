import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { NAV_ICONS } from "./aarTopNavIcons";
import { AlertsToolbar } from "./AlertsToolbar";
import { UserMenu } from "./UserMenu";
import "./aar-top-nav.css";

const ICON_SZ = 18;
const ICON_STROKE = 2;

type SiteRow = { id: string; name: string };

type NavDef = {
  key: keyof typeof NAV_ICONS;
  label: string;
  to: string;
  isActive: (pathname: string) => boolean;
};

/** Paths match existing App routes (no new routes). */
const NAV_ITEMS: NavDef[] = [
  {
    key: "devices",
    label: "Devices",
    to: "/devices/register",
    isActive: (p) => p.startsWith("/devices"),
  },
  {
    key: "pipelines",
    label: "Pipelines",
    to: "/scrubber/v2/pipelines",
    isActive: (p) => p.startsWith("/scrubber/v2"),
  },
  {
    key: "workflows",
    label: "Workflows",
    to: "/workflow/list",
    isActive: (p) => p === "/workflow" || p.startsWith("/workflow/"),
  },
  {
    key: "dashboards",
    label: "Dashboards",
    to: "/dashboard/list",
    isActive: (p) => p.startsWith("/dashboard"),
  },
  { key: "ai", label: "AI", to: "/enterprise-ai", isActive: (p) => p.startsWith("/enterprise-ai") },
  {
    key: "monitoring",
    label: "Monitoring",
    to: "/administration/monitoring",
    isActive: (p) => p.startsWith("/administration/monitoring"),
  },
];

export type AarTopNavProps = {
  customerName: string;
  /** Primary line for site (e.g. single site name or "3 sites"). */
  siteSummary: string;
  sites: SiteRow[];
  selectedSiteId: string | null;
  onSiteChange: (siteId: string | null) => void;
  alertCount: number;
  alertTone: "none" | "critical" | "warning" | "info";
  onRefresh: () => void;
};

export function AarTopNav({
  customerName,
  siteSummary,
  sites,
  selectedSiteId,
  onSiteChange,
  alertCount,
  alertTone,
  onRefresh,
}: AarTopNavProps) {
  const { pathname } = useLocation();
  const [siteOpen, setSiteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const siteRootRef = useRef<HTMLDivElement>(null);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    if (!siteOpen) return;
    function onDoc(e: MouseEvent) {
      if (!siteRootRef.current?.contains(e.target as Node)) setSiteOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSiteOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [siteOpen]);

  useEffect(() => {
    closeMobile();
  }, [pathname, closeMobile]);

  const siteButtonLabel =
    selectedSiteId && sites.length
      ? sites.find((s) => s.id === selectedSiteId)?.name ?? siteSummary
      : siteSummary;

  return (
    <header className="aar-topnav">
      <button
        type="button"
        className="aar-topnav__menu-toggle"
        aria-expanded={mobileOpen}
        aria-controls="aar-topnav-primary"
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
        onClick={() => setMobileOpen((o) => !o)}
      >
        {mobileOpen ? <X size={ICON_SZ} strokeWidth={ICON_STROKE} aria-hidden /> : <Menu size={ICON_SZ} strokeWidth={ICON_STROKE} aria-hidden />}
      </button>

      <div className="aar-topnav__brand">
        <div className="aar-topnav__logo" aria-hidden>
          A
        </div>
        <div className="aar-topnav__brand-text">
          <div className="aar-topnav__product">AAR-IoT-Studio</div>
          <div className="aar-topnav__context">
            <span className="aar-topnav__context-label">
              Customer: <strong className="aar-topnav__context-strong">{customerName}</strong>
            </span>
            <span className="aar-topnav__dot" aria-hidden>
              |
            </span>
            <span className="aar-topnav__context-label">Site:</span>
            <div className="aar-topnav__site-wrap" ref={siteRootRef}>
              <button
                type="button"
                className="aar-topnav__site"
                aria-expanded={siteOpen}
                disabled={sites.length === 0}
                onClick={() => sites.length > 0 && setSiteOpen((o) => !o)}
              >
                {siteButtonLabel}
                <NAV_ICONS.chevron size={14} strokeWidth={ICON_STROKE} aria-hidden className="aar-topnav__site-chevron" />
              </button>
              {siteOpen && sites.length > 0 ? (
                <div className="aar-topnav__site-panel" role="listbox" aria-label="Sites">
                  <button
                    type="button"
                    role="option"
                    className={`aar-topnav__site-option${selectedSiteId == null ? " aar-topnav__site-option--active" : ""}`}
                    onClick={() => {
                      onSiteChange(null);
                      setSiteOpen(false);
                    }}
                  >
                    All sites
                  </button>
                  {sites.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="option"
                      className={`aar-topnav__site-option${selectedSiteId === s.id ? " aar-topnav__site-option--active" : ""}`}
                      onClick={() => {
                        onSiteChange(s.id);
                        setSiteOpen(false);
                      }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <nav
        id="aar-topnav-primary"
        className={`aar-topnav__nav${mobileOpen ? " aar-topnav__nav--mobile-open" : ""}`}
        aria-label="Primary navigation"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = NAV_ICONS[item.key];
          const active = item.isActive(pathname);
          return (
            <NavLink
              key={item.key}
              to={item.to}
              className={`aar-topnav__item${active ? " aar-topnav__item--active" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={closeMobile}
            >
              <Icon size={ICON_SZ} strokeWidth={ICON_STROKE} aria-hidden className="aar-topnav__item-icon" />
              <span className="aar-topnav__item-label">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="aar-topnav__utilities">
        <button type="button" className="aar-topnav__utility" onClick={onRefresh} title="Refresh data">
          <NAV_ICONS.refresh size={ICON_SZ} strokeWidth={ICON_STROKE} aria-hidden />
          <span className="aar-topnav__utility-label">Refresh</span>
        </button>

        <AlertsToolbar unacked={alertCount} alertTone={alertTone} className="aar-topnav__alerts" />

        <div className="aar-topnav__user">
          <UserMenu iconOnly />
        </div>
      </div>

      {mobileOpen ? <button type="button" className="aar-topnav__backdrop" aria-label="Close menu" onClick={closeMobile} /> : null}
    </header>
  );
}
