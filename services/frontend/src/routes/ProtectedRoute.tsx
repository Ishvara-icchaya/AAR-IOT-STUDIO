import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getToken } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";

export function ProtectedRoute() {
  const { me, loading } = useAuth();
  const loc = useLocation();

  if (!getToken()) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
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
  return <Outlet />;
}
