import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch, getToken, setToken } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { dbg } from "@/lib/debug";

type TokenResponse = { access_token: string; token_type: string };

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const navigate = useNavigate();
  const loc = useLocation();
  const { refresh } = useAuth();
  const from = (loc.state as { from?: string } | null)?.from ?? "/enterprise-dashboard";

  useEffect(() => {
    if (getToken()) void refresh().then(() => navigate(from, { replace: true }));
  }, [from, navigate, refresh]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    dbg("LoginPage submit", { email });
    try {
      const data = await apiFetch<TokenResponse>("/auth/login", {
        method: "POST",
        json: { email, password },
      });
      if (!data?.access_token) throw new Error("No token in response");
      setToken(data.access_token);
      await refresh();
      navigate(from, { replace: true });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Sign in</h1>
        <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
          Default bootstrap: <code>admin@example.com</code> / <code>admin123</code> (change via env)
        </p>
        <form onSubmit={onSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
          <label htmlFor="pass">Password</label>
          <input
            id="pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <button type="submit">Sign in</button>
        </form>
        {msg && (
          <p style={{ marginTop: "1rem", color: "#f66", fontSize: "0.9rem" }}>
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
