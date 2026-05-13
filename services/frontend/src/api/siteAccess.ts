import { apiFetch } from "@/api/client";

/** Site-scoped roles assignable via membership APIs (matches backend SITE_ROLE_KEYS). */
export const SITE_ROLE_KEYS = [
  "site_admin",
  "developer",
  "device_operator",
  "device_viewer",
  "dashboard_viewer",
] as const;

export type SiteMemberRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  status: string;
  role_key: string | null;
  role_name: string | null;
  sites_count: number;
  last_login_at: string | null;
};

export async function listSiteMembers(siteId: string) {
  return apiFetch<{ items: SiteMemberRow[] }>(`/sites/${encodeURIComponent(siteId)}/members`);
}

export async function addSiteMember(siteId: string, body: { email: string; role: string }) {
  return apiFetch<SiteMemberRow>(`/sites/${encodeURIComponent(siteId)}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function patchSiteMemberRole(siteId: string, userId: string, body: { role: string }) {
  return apiFetch<SiteMemberRow>(
    `/sites/${encodeURIComponent(siteId)}/members/${encodeURIComponent(userId)}/role`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export async function removeSiteMember(siteId: string, userId: string) {
  await apiFetch<void>(`/sites/${encodeURIComponent(siteId)}/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export type RoleCatalogItem = {
  id: string;
  role_key: string;
  name: string;
  description: string | null;
  permission_keys: string[];
};

export async function listRolesCatalog() {
  return apiFetch<RoleCatalogItem[]>("/roles");
}
