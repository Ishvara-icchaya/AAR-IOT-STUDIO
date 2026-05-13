import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Inbox } from "lucide-react";
import { getToken } from "@/api/client";
import { listWorkspaceMessages, workspaceAttachmentUrl, type WorkspaceInboxItem } from "@/api/workspace";
import { AppModalShell } from "@/components/app/AppModalShell";
import { OpsStatusPill } from "@/components/ops/OpsStatusPill";
import { useWorkspace } from "@/contexts/WorkspaceContext";

import "@/components/app/app-modal.css";
import "@/pages/device-register-page.css";

function categoryVariant(cat: string): "online" | "muted" {
  if (cat === "lineage_share") return "online";
  return "muted";
}

export function WorkspaceInboxModal() {
  const { open, closeWorkspace, inboxRefreshKey } = useWorkspace();
  const [items, setItems] = useState<WorkspaceInboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const rows = await listWorkspaceMessages();
      setItems(rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load workspace");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, inboxRefreshKey, load]);

  const onDownload = useCallback(async (m: WorkspaceInboxItem) => {
    const token = getToken();
    const url = workspaceAttachmentUrl(m.id);
    const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!r.ok) {
      setErr(await r.text().catch(() => r.statusText));
      return;
    }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = m.attachment_filename || "attachment";
    a.click();
    URL.revokeObjectURL(a.href);
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, WorkspaceInboxItem[]>();
    for (const m of items) {
      const k = m.category || "general";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <AppModalShell
      open={open}
      onClose={closeWorkspace}
      title="Workspace"
      titleId="workspace-inbox-title"
      subtitle="Messages and attachments shared by teammates (chat coming later)."
      size="lg"
      dialogClassName="workspace-inbox-modal"
    >
      <div className="workspace-inbox">
        {loading ? <p className="dash-widget__muted">Loading…</p> : null}
        {err ? <p className="workspace-inbox__err">{err}</p> : null}
        {!loading && !items.length && !err ? (
          <div className="workspace-inbox__empty">
            <Inbox size={36} strokeWidth={1.5} aria-hidden className="workspace-inbox__empty-icon" />
            <p>No workspace items yet. When someone sends you a lineage summary or other share, it will appear here.</p>
          </div>
        ) : null}
        {grouped.map(([cat, rows]) => (
          <section key={cat} className="workspace-inbox__group">
            <h3 className="workspace-inbox__group-title">
              <OpsStatusPill status={cat} variant={categoryVariant(cat)} />
              <span className="workspace-inbox__group-count">{rows.length}</span>
            </h3>
            <ul className="workspace-inbox__list">
              {rows.map((m) => (
                <li key={m.id} className="workspace-inbox__card">
                  <div className="workspace-inbox__card-head">
                    <strong className="workspace-inbox__title">{m.title}</strong>
                    <span className="workspace-inbox__meta">
                      From {m.sender_name?.trim() ? `${m.sender_name} · ` : ""}
                      {m.sender_email}
                    </span>
                    <span className="workspace-inbox__date">{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                  {m.body?.trim() ? <p className="workspace-inbox__body">{m.body}</p> : null}
                  {m.has_attachment ? (
                    <div className="workspace-inbox__attach">
                      <span className="workspace-inbox__fname">{m.attachment_filename ?? "Attachment"}</span>
                      <button type="button" className="dm-btn dm-btn--outline dm-btn--compact" onClick={() => void onDownload(m)}>
                        <Download size={14} strokeWidth={2} aria-hidden />
                        Download
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </AppModalShell>
  );
}
