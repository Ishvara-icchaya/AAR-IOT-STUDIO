import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";

export function OnboardingChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const navigate = useNavigate();
  const { refresh, me, loading } = useAuth();

  useEffect(() => {
    if (!loading && me != null && me.must_change_password !== true) {
      navigate("/enterprise-dashboard", { replace: true });
    }
  }, [loading, me, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) {
      setMsg("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setMsg("New password and confirmation do not match.");
      return;
    }
    try {
      await apiFetch<null>("/auth/change-password", {
        method: "POST",
        json: { current_password: current, new_password: next },
      });
      await refresh();
      navigate("/enterprise-dashboard", { replace: true });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not change password");
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Set your password</h1>
        <p style={{ fontSize: "0.88rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
          For security, change the bootstrap password before using the platform.
        </p>
        <form onSubmit={onSubmit}>
          <label htmlFor="cur">Current password</label>
          <input
            id="cur"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
          <label htmlFor="nw">New password</label>
          <input
            id="nw"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <label htmlFor="cf">Confirm new password</label>
          <input
            id="cf"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <button type="submit" style={{ marginTop: "0.75rem" }}>
            Continue
          </button>
        </form>
        {msg ? (
          <p style={{ marginTop: "1rem", color: "#f66", fontSize: "0.9rem" }}>{msg}</p>
        ) : null}
      </div>
    </div>
  );
}
