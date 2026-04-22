import { FormEvent, useEffect, useId, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Box,
  Eye,
  EyeOff,
  GitBranch,
  Lock,
  Mail,
  Plug,
  ShieldCheck,
} from "lucide-react";
import { apiFetch, getToken, setToken } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { LoginHeroGraphic } from "@/components/login/LoginHeroGraphic";
import { dbg } from "@/lib/debug";
import "./login-page.css";

type TokenResponse = { access_token: string; token_type: string };

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C43.86 39.79 46.98 33.13 46.98 24.55z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function OktaMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="none" stroke="#007dc1" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="#007dc1" />
    </svg>
  );
}

export function LoginPage() {
  const emailId = useId();
  const passId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="login-v2">
      <div className="login-v2__left">
        <header className="login-v2__brand">
          <span className="login-v2__brand-icon" aria-hidden>
            <Box size={22} strokeWidth={1.75} />
          </span>
          <span className="login-v2__brand-name">AAR IoT Studio</span>
        </header>

        <h1 className="login-v2__headline">
          Connect. Monitor. <span className="login-v2__headline-accent">Act.</span>
        </h1>
        <p className="login-v2__lead">
          A unified platform to connect devices, orchestrate pipelines, and visualize real-time insights.
        </p>

        <ul className="login-v2__features">
          <li className="login-v2__feature">
            <span className="login-v2__feature-icon" aria-hidden>
              <Plug size={18} strokeWidth={2} />
            </span>
            <div>
              <p className="login-v2__feature-title">Connect Devices</p>
              <p className="login-v2__feature-desc">Onboard and manage IoT devices securely.</p>
            </div>
          </li>
          <li className="login-v2__feature">
            <span className="login-v2__feature-icon" aria-hidden>
              <GitBranch size={18} strokeWidth={2} />
            </span>
            <div>
              <p className="login-v2__feature-title">Build Pipelines</p>
              <p className="login-v2__feature-desc">Process, transform, and route data at scale.</p>
            </div>
          </li>
          <li className="login-v2__feature">
            <span className="login-v2__feature-icon" aria-hidden>
              <BarChart3 size={18} strokeWidth={2} />
            </span>
            <div>
              <p className="login-v2__feature-title">Gain Insights</p>
              <p className="login-v2__feature-desc">Visualize, analyze, and act on real-time data.</p>
            </div>
          </li>
          <li className="login-v2__feature">
            <span className="login-v2__feature-icon" aria-hidden>
              <ShieldCheck size={18} strokeWidth={2} />
            </span>
            <div>
              <p className="login-v2__feature-title">Enterprise Ready</p>
              <p className="login-v2__feature-desc">Secure, reliable, and built for scale.</p>
            </div>
          </li>
        </ul>

        <div className="login-v2__visual">
          <LoginHeroGraphic />
        </div>

        <div className="login-v2__security">
          <ShieldCheck className="login-v2__security-icon" size={22} strokeWidth={2} aria-hidden />
          <div>
            <p className="login-v2__security-title">Your data is secure</p>
            <p className="login-v2__security-desc">
              Encryption in transit and at rest, with role-based access for your organization.
            </p>
            <a className="login-v2__security-link" href="#">
              Learn more
              <ArrowRight size={14} strokeWidth={2.5} aria-hidden />
            </a>
          </div>
        </div>

        <footer className="login-v2__footer">
          <span>© 2026 AAR IoT Studio. All rights reserved.</span>
          <span aria-hidden>|</span>
          <a href="#">Privacy Policy</a>
          <span aria-hidden>|</span>
          <a href="#">Terms of Service</a>
        </footer>
      </div>

      <div className="login-v2__right">
        <div className="login-v2__card">
          <h2 className="login-v2__card-title">Welcome back</h2>
          <p className="login-v2__card-sub">Sign in to your account</p>
          <p className="login-v2__dev-hint">
            Default bootstrap: <code>admin@example.com</code> / <code>admin123</code> (change via env)
          </p>

          <form onSubmit={onSubmit}>
            <div className="login-v2__field">
              <label htmlFor={emailId}>Email</label>
              <div className="login-v2__input">
                <Mail className="login-v2__input-icon" size={18} strokeWidth={2} aria-hidden />
                <input
                  id={emailId}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                  placeholder="admin@example.com"
                />
              </div>
            </div>
            <div className="login-v2__field">
              <label htmlFor={passId}>Password</label>
              <div className="login-v2__input">
                <Lock className="login-v2__input-icon" size={18} strokeWidth={2} aria-hidden />
                <input
                  id={passId}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="login-v2__toggle-visibility"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="login-v2__row-between">
              <button type="button" className="login-v2__link" title="Contact your administrator">
                Forgot password?
              </button>
            </div>

            <button className="login-v2__submit" type="submit">
              Sign in
            </button>
          </form>

          <div className="login-v2__divider" role="separator">
            <span>or continue with</span>
          </div>

          <div className="login-v2__sso">
            <button type="button" className="login-v2__sso-btn" disabled title="Not configured">
              <GoogleMark />
              Continue with Google
            </button>
            <button type="button" className="login-v2__sso-btn" disabled title="Not configured">
              <MicrosoftMark />
              Continue with Microsoft (AD)
            </button>
            <button type="button" className="login-v2__sso-btn" disabled title="Not configured">
              <OktaMark />
              Continue with Okta
            </button>
          </div>

          <p className="login-v2__sso-hint">
            <ShieldCheck size={16} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: "0.1rem" }} />
            <span>SSO options will be configured by your administrator.</span>
          </p>

          {msg ? <p className="login-v2__error">{msg}</p> : null}
        </div>
      </div>
    </div>
  );
}
