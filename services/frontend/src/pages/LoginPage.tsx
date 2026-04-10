import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch, getToken, setToken } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { LoginHeroGraphic } from "@/components/login/LoginHeroGraphic";
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
    <div className="login-page login-page--split">
      <div className="login-page__brand">
        <div className="login-page__brand-mesh" aria-hidden />
        <div className="login-page__brand-inner">
          <div className="login-page__brand-mark">
            <span className="login-page__brand-icon" aria-hidden>
              <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="4" y="6" width="10" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <rect x="18" y="10" width="10" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.85" />
                <path d="M14 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <span className="login-page__brand-name">AAR IoT Studio</span>
          </div>
          <div className="login-page__hero-wrap">
            <LoginHeroGraphic />
          </div>
          <p className="login-page__tagline">
            Connect devices, pipelines, and dashboards in one secure workspace.
          </p>
        </div>
      </div>

      <div className="login-page__form">
        <div className="login-card login-card--signin">
          <h1 className="login-card-title">Sign in</h1>
          <p className="login-card-subtitle">
            Default bootstrap: <code>admin@example.com</code> / <code>admin123</code> (change via env)
          </p>
          <form className="login-form" onSubmit={onSubmit}>
            <div className="login-field">
              <label htmlFor="email">Email</label>
              <div className="login-input-shell">
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                  placeholder="you@company.com"
                />
              </div>
            </div>
            <div className="login-field">
              <label htmlFor="pass">Password</label>
              <div className="login-input-shell">
                <input
                  id="pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                />
              </div>
            </div>
            <button className="login-submit" type="submit">
              Sign in
            </button>
          </form>
          {msg ? <p className="login-card-error">{msg}</p> : null}
        </div>
      </div>
    </div>
  );
}
