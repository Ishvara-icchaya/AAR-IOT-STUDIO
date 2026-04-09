import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { userIsAdmin } from "@/layouts/shell/navigation";

export function RequireAdmin() {
  const { me } = useAuth();
  if (!userIsAdmin(me?.role, me?.is_superuser)) {
    return <Navigate to="/enterprise-dashboard" replace />;
  }
  return <Outlet />;
}
