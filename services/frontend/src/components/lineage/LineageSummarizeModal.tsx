import { useCallback, useEffect, useMemo, useState } from "react";
import { FileDown, Send } from "lucide-react";
import { isApiHttpError } from "@/api/client";
import { listWorkspaceRecipients, sendWorkspaceMessage, type WorkspaceRecipient } from "@/api/workspace";
import { AppModalShell } from "@/components/app/AppModalShell";
import { AarButton } from "@/components/system/AarButton";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { buildDeviceFootprintSummaryPdfBlob, footprintPdfFilename, type DeviceFootprintPdfInput } from "@/lib/lineageSummaryPdf";

import "@/components/app/app-modal.css";
import "@/pages/device-register-page.css";

type Props = {
  /** Controlled visibility (parent may keep snapshot mounted briefly). */
  open: boolean;
  onClose: () => void;
  pdfInput: DeviceFootprintPdfInput;
};

export function LineageSummarizeModal({ open, onClose, pdfInput }: Props) {
  const { bumpInbox } = useWorkspace();
  const [step, setStep] = useState<"main" | "send">("main");
  const [recipients, setRecipients] = useState<WorkspaceRecipient[]>([]);
  const [recipFilter, setRecipFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep("main");
      setRecipFilter("");
      setSelectedId(null);
      setNote("");
      setErr(null);
      setRecipients([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listWorkspaceRecipients();
        if (!cancelled) setRecipients(rows);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load users");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filteredRecipients = useMemo(() => {
    const q = recipFilter.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter(
      (r) => r.email.toLowerCase().includes(q) || (r.full_name && r.full_name.toLowerCase().includes(q)),
    );
  }, [recipients, recipFilter]);

  const exportPdf = useCallback(() => {
    const blob = buildDeviceFootprintSummaryPdfBlob(pdfInput);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = footprintPdfFilename(pdfInput.deviceName);
    a.click();
    URL.revokeObjectURL(a.href);
  }, [pdfInput]);

  const sendPdf = useCallback(async () => {
    if (!selectedId) {
      setErr("Select a recipient.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const blob = buildDeviceFootprintSummaryPdfBlob(pdfInput);
      const fname = footprintPdfFilename(pdfInput.deviceName);
      await sendWorkspaceMessage({
        recipientId: selectedId,
        category: "lineage_share",
        title: `Footprint: ${pdfInput.deviceName} · ${new Date().toLocaleString()}`,
        body: note.trim() || undefined,
        file: blob,
        filename: fname,
      });
      bumpInbox();
      onClose();
    } catch (e) {
      setErr(isApiHttpError(e) ? e.message : e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }, [selectedId, note, pdfInput, bumpInbox, onClose]);

  return (
    <AppModalShell
      open={open}
      onClose={onClose}
      title="Summarize footprint"
      titleId="lineage-summarize-title"
      subtitle="Export this device’s operational footprint to PDF or send it to a teammate (Workspace inbox)."
      size="md"
      dialogClassName="lineage-summarize-modal"
    >
      {step === "main" ? (
        <div className="lineage-summarize">
          <p className="lineage-summarize__lead dash-widget__muted">
            PDF includes summary, pipeline snapshot, version lineage (if loaded), KPI map, and full footprint JSON for{" "}
            <strong>{pdfInput.deviceName}</strong>.
          </p>
          <div className="lineage-summarize__actions">
            <AarButton type="button" variant="outline" onClick={exportPdf}>
              <FileDown size={16} strokeWidth={2} aria-hidden />
              Download PDF
            </AarButton>
            <AarButton type="button" variant="primary" onClick={() => setStep("send")}>
              <Send size={16} strokeWidth={2} aria-hidden />
              Send to…
            </AarButton>
          </div>
        </div>
      ) : (
        <div className="lineage-summarize lineage-summarize--send">
          <button type="button" className="lineage-summarize__back dm-btn dm-btn--outline dm-btn--compact" onClick={() => setStep("main")}>
            ← Back
          </button>
          <label className="lineage-summarize__field">
            <span>Find user</span>
            <input
              className="dm-search-input"
              value={recipFilter}
              onChange={(e) => setRecipFilter(e.target.value)}
              placeholder="Filter by name or email…"
              aria-label="Filter recipients"
            />
          </label>
          <div className="lineage-summarize__user-list" role="listbox" aria-label="Recipients">
            {filteredRecipients.map((r) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={selectedId === r.id}
                className={`lineage-summarize__user${selectedId === r.id ? " lineage-summarize__user--selected" : ""}`}
                onClick={() => setSelectedId(r.id)}
              >
                <span className="lineage-summarize__user-email">{r.email}</span>
                {r.full_name?.trim() ? <span className="lineage-summarize__user-name">{r.full_name}</span> : null}
              </button>
            ))}
            {!filteredRecipients.length ? <p className="dash-widget__muted">No users match this filter.</p> : null}
          </div>
          <label className="lineage-summarize__field">
            <span>Message (optional)</span>
            <textarea className="lineage-summarize__textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {err ? <p className="lineage-summarize__err">{err}</p> : null}
          <div className="lineage-summarize__actions">
            <AarButton type="button" variant="primary" disabled={busy} onClick={() => void sendPdf()}>
              {busy ? "Sending…" : "Send PDF to workspace"}
            </AarButton>
          </div>
        </div>
      )}
    </AppModalShell>
  );
}
