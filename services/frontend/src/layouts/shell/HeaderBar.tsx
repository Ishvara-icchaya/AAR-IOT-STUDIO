import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { getAlertsSummary } from "@/api/alerts";
import { AdminDropdown } from "./AdminDropdown";
import { AlertsToolbar } from "./AlertsToolbar";
import { MainNav } from "./MainNav";
import { AppearancePickers } from "./AppearancePickers";
import { UserMenu } from "./UserMenu";
import { userIsAdmin } from "./navigation";

type SiteRow = { id: string; name: string };

export function HeaderBar() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [unacked, setUnacked] = useState(0);
  const [alertTone, setAlertTone] = useState<"none" | "critical" | "warning" | "info">("none");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const showAdmin = userIsAdmin(me?.role, me?.is_superuser);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiFetch<SiteRow[]>("/administration/sites");
        if (!cancelled) setSites(data ?? []);
      } catch {
        if (!cancelled) setSites([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const s = await getAlertsSummary();
        if (!cancelled && s) {
          setUnacked(s.total_unacknowledged);
          const c = s.critical ?? (s.has_critical ? 1 : 0);
          const w = s.warning ?? 0;
          const i = s.info ?? 0;
          if (c > 0) setAlertTone("critical");
          else if (w > 0) setAlertTone("warning");
          else if (i > 0) setAlertTone("info");
          else setAlertTone("none");
        }
      } catch {
        if (!cancelled) {
          setUnacked(0);
          setAlertTone("none");
        }
      }
    }
    void poll();
    const t = window.setInterval(() => void poll(), 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const customerLabel = (me?.customer_name || "").trim() || "—";
  let siteLabel = "—";
  if (sites.length === 1) siteLabel = sites[0].name;
  else if (sites.length > 1) siteLabel = `${sites.length} sites`;

  return (
    <header className="shell-header" aria-label="Application header">
      <div className="shell-header__left">
        <button
          type="button"
          className="shell-header__menu-toggle"
          aria-expanded={mobileNavOpen}
          aria-controls="shell-primary-nav"
          onClick={() => setMobileNavOpen((o) => !o)}
        >
          ☰
        </button>
        <div className="shell-header__brand">
          <span className="shell-header__product">AAR-IoT-Studio</span>
          <span className="shell-header__context" title={`Customer: ${customerLabel} · Site: ${siteLabel}`}>
            <span className="shell-header__ctx-item">
              Customer: <strong>{customerLabel}</strong>
            </span>
            <span className="shell-header__ctx-sep" aria-hidden>
              |
            </span>
            <span className="shell-header__ctx-item">
              Site: <strong>{siteLabel}</strong>
            </span>
          </span>
        </div>
      </div>

      <div className="shell-header__center">
        <MainNav
          mobileOpen={mobileNavOpen}
          onNavigate={() => setMobileNavOpen(false)}
        />
      </div>

      <div className="shell-header__right">
        <AlertsToolbar unacked={unacked} alertTone={alertTone} />
        <AppearancePickers />
        {showAdmin ? <AdminDropdown /> : null}
        <UserMenu />
        <button
          type="button"
          className="shell__logout-btn"
          onClick={() => {
            logout();
            navigate("/login", { replace: true });
          }}
        >
          Log out
        </button>
      </div>
    </header>
  );
}
