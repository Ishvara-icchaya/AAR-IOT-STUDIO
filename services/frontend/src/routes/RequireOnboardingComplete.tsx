import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

/** After login: force change-password then naming the default customer before main shell. */
export function RequireOnboardingComplete() {
  const { me, loading } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div className="login-page">
        <p style={{ color: "var(--color-text-muted)" }}>Loading session…</p>
      </div>
    );
  }
  if (!me) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  if (me.must_change_password === true) {
    return <Navigate to="/onboarding/change-password" replace state={{ from: loc.pathname }} />;
  }
  if (me.needs_customer_setup === true) {
    return <Navigate to="/onboarding/customer" replace />;
  }
  return <Outlet />;
}
