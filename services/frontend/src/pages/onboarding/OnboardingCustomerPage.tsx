import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { patchCustomerName } from "@/api/administration";
import { useAuth } from "@/auth/AuthContext";

export function OnboardingCustomerPage() {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const navigate = useNavigate();
  const { refresh, me, loading } = useAuth();

  useEffect(() => {
    if (!loading && me != null && me.needs_customer_setup !== true) {
      navigate("/enterprise-dashboard", { replace: true });
    }
  }, [loading, me, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const n = name.trim();
    if (n.length < 2) {
      setMsg("Enter a meaningful organization name.");
      return;
    }
    if (n.toLowerCase() === "default customer") {
      setMsg("Choose a name other than the placeholder.");
      return;
    }
    try {
      await patchCustomerName(n);
      await refresh();
      navigate("/enterprise-dashboard", { replace: true });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not save");
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Name your organization</h1>
        <p style={{ fontSize: "0.88rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
          Replace the bootstrap tenant name <code>Default customer</code> with your company or site name.
        </p>
        {me?.customer_name ? (
          <p style={{ fontSize: "0.82rem", color: "var(--color-text-muted)", marginTop: 0 }}>
            Current: <strong>{me.customer_name}</strong>
          </p>
        ) : null}
        <form onSubmit={onSubmit}>
          <label htmlFor="org">Organization name</label>
          <input
            id="org"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="organization"
            required
            minLength={2}
            maxLength={255}
            placeholder="e.g. Acme Industrial — Building 4"
          />
          <button type="submit" style={{ marginTop: "0.75rem" }}>
            Continue to app
          </button>
        </form>
        {msg ? (
          <p style={{ marginTop: "1rem", color: "#f66", fontSize: "0.9rem" }}>{msg}</p>
        ) : null}
      </div>
    </div>
  );
}
