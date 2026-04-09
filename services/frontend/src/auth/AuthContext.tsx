import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch, clearToken, getToken } from "@/api/client";

export type Me = {
  id: string;
  email: string;
  role: string;
  customer_id: string;
  is_superuser: boolean;
  /** When absent (older API), onboarding treats as false / skip. */
  must_change_password?: boolean;
  customer_name?: string;
  needs_customer_setup?: boolean;
};

type AuthState = {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<Me>("/auth/me");
      setMe(data);
    } catch {
      clearToken();
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    clearToken();
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ me, loading, refresh, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
