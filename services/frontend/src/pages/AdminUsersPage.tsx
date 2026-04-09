import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/api/client";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  site_ids: string[];
};

export function AdminUsersPage() {
  const [items, setItems] = useState<UserRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "operator">("operator");

  async function load() {
    setErr(null);
    try {
      const data = await apiFetch<UserRow[]>("/administration/users");
      setItems(data ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load users");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await apiFetch("/administration/users", {
        method: "POST",
        json: { email, password, role, site_ids: [] },
      });
      setEmail("");
      setPassword("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    }
  }

  return (
    <PageShell title="Create Users">
      <p style={{ color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        Administrator only. Operators can be assigned to sites in a follow-up.
      </p>
      {err ? (
        <PageStatus variant="error">
          <p>{err}</p>
          {err.includes("No response") || err.includes("NetworkError") || err.includes("Failed to fetch") ? (
            <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.85rem" }}>
              The UI could not reach the API. From the repo root start the stack (e.g.{" "}
              <code style={{ color: "var(--color-accent)" }}>docker compose up -d api</code> or{" "}
              <code style={{ color: "var(--color-accent)" }}>./run.sh up</code>
              ), confirm something is listening on port <strong>8000</strong>, and that{" "}
              <code style={{ color: "var(--color-accent)" }}>VITE_API_BASE_URL</code> matches how you open the app (
              <code style={{ color: "var(--color-accent)" }}>http://localhost:8000/api/v1</code> when using defaults).
            </p>
          ) : null}
        </PageStatus>
      ) : null}
      <form
        onSubmit={onCreate}
        style={{
          display: "grid",
          gap: "0.5rem",
          maxWidth: "420px",
          marginBottom: "1.5rem",
        }}
      >
        <input
          type="email"
          placeholder="Email"
          value={email}
          required
          onChange={(e) => setEmail(e.target.value)}
          style={inp}
        />
        <input
          type="password"
          placeholder="Password (min 8)"
          value={password}
          required
          minLength={8}
          onChange={(e) => setPassword(e.target.value)}
          style={inp}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "operator")} style={inp}>
          <option value="operator">operator</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit" style={btn}>
          Create user
        </button>
      </form>
      <div style={{ overflow: "auto", maxHeight: "min(50dvh, 360px)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
              <th style={th}>Email</th>
              <th style={th}>Role</th>
              <th style={th}>Active</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                <td style={td}>{u.email}</td>
                <td style={td}>{u.role}</td>
                <td style={td}>{u.is_active ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}

const inp: CSSProperties = {
  padding: "0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
};

const btn: CSSProperties = {
  padding: "0.6rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "#fff",
  fontFamily: "inherit",
  fontWeight: 600,
  cursor: "pointer",
};

const th: CSSProperties = { padding: "0.35rem 0.5rem", color: "var(--color-text-muted)" };
const td: CSSProperties = { padding: "0.35rem 0.5rem" };
