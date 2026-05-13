import { apiFetch } from "./client";

export type WorkspaceRecipient = {
  id: string;
  email: string;
  full_name: string | null;
};

export type WorkspaceInboxItem = {
  id: string;
  category: string;
  title: string;
  body: string | null;
  sender_email: string;
  sender_name: string | null;
  has_attachment: boolean;
  attachment_filename: string | null;
  attachment_mime: string | null;
  read_at: string | null;
  created_at: string;
};

export async function listWorkspaceRecipients(): Promise<WorkspaceRecipient[]> {
  const data = await apiFetch<WorkspaceRecipient[]>("/workspace/recipients");
  return data ?? [];
}

export async function listWorkspaceMessages() {
  const data = await apiFetch<{ items: WorkspaceInboxItem[] }>("/workspace/messages");
  return data?.items ?? [];
}

export async function sendWorkspaceMessage(params: {
  recipientId: string;
  category: "lineage_share" | "general";
  title: string;
  body?: string;
  file?: Blob | null;
  filename?: string;
}) {
  const fd = new FormData();
  fd.set("recipient_id", params.recipientId);
  fd.set("category", params.category);
  fd.set("title", params.title);
  if (params.body?.trim()) fd.set("body", params.body.trim());
  if (params.file && params.filename) {
    fd.set("file", params.file, params.filename);
  }
  const res = await apiFetch<{ id: string; ok: boolean }>("/workspace/messages", { method: "POST", body: fd });
  if (!res) throw new Error("No response from server");
  return res;
}

export function workspaceAttachmentUrl(messageId: string) {
  const rawBase = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
  const base = String(rawBase).replace(/\/$/, "");
  return `${base}/workspace/messages/${encodeURIComponent(messageId)}/attachment`;
}
