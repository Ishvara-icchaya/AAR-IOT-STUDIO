import { traceHeadersEnabled } from "@/lib/debug";

const TOKEN_KEY = "aar_access_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** Relative default (`/api/v1`) uses Vite dev proxy → same host as the UI (works with LAN IP :5173). */
const rawBase = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
const base = String(rawBase).replace(/\/$/, "");

function formatError(data: unknown, statusText: string): string {
  if (data && typeof data === "object" && "detail" in data) {
    const d = (data as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return JSON.stringify(d);
    return JSON.stringify(d);
  }
  return statusText;
}

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T | null> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (traceHeadersEnabled && typeof crypto !== "undefined" && crypto.randomUUID) {
    headers["X-Trace-Id"] = crypto.randomUUID();
  }
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (init?.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init?.body !== undefined && init?.body !== null) {
    body = init.body as BodyInit;
  }
  const url = `${base}${path}`;
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers, body });
  } catch (e) {
    const isTypeError = e instanceof TypeError;
    const baseHint = isTypeError
      ? ` No response from ${url}. With Docker, use default VITE_API_BASE_URL=/api/v1 (Vite proxies to the api service). If you set a full URL to :8000, open the UI from the same machine or fix the URL. Start the stack: docker compose up -d api frontend. For direct browser→API calls, add your UI origin to API_CORS_ORIGINS.`
      : "";
    throw new Error(`${e instanceof Error ? e.message : "Network error"}.${baseHint}`);
  }
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(formatError(data, r.statusText));
  return data as T;
}
