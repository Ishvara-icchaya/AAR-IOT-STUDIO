import { useCallback, useState, type RefObject } from "react";
import html2canvas from "html2canvas";

/** html2canvas expects a simple canvas fill; avoid oklch/lab from getComputedStyle(document.body). */
function screenshotCanvasBackground(): string {
  const raw = getComputedStyle(document.body).backgroundColor;
  if (!raw || raw === "transparent" || raw === "rgba(0, 0, 0, 0)") return "#101620";
  if (/^(oklab|oklch|lab|lch|color)\(/i.test(raw)) return "#101620";
  return raw;
}

type Props = {
  captureRef: RefObject<HTMLElement | null>;
  fileBaseName: string;
  refreshIntervalSec: number;
  paused: boolean;
  onTogglePause: () => void;
  onManualRefresh: () => void;
};

export function DashboardLiveToolbar({
  captureRef,
  fileBaseName,
  refreshIntervalSec,
  paused,
  onTogglePause,
  onManualRefresh,
}: Props) {
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [shotMsg, setShotMsg] = useState<string | null>(null);

  const onScreenshot = useCallback(async () => {
    const el = captureRef.current;
    if (!el || screenshotBusy) return;
    setScreenshotBusy(true);
    setShotMsg(null);
    try {
      const scale = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
      const canvas = await html2canvas(el, {
        scale,
        useCORS: true,
        allowTaint: false,
        foreignObjectRendering: false,
        logging: false,
        backgroundColor: screenshotCanvasBackground(),
        removeContainer: true,
        ignoreElements: (node) =>
          node instanceof HTMLElement &&
          (node.classList.contains("maplibregl-canvas") ||
            node.classList.contains("maplibregl-control-container")),
        onclone(clonedDoc) {
          const style = clonedDoc.createElement("style");
          style.setAttribute("data-dashboard-screenshot", "1");
          /* Simplify runtime chrome so html2canvas does not choke on color-mix / layered backgrounds / pseudo grid. */
          style.textContent = `
            .dashboard-runtime::before { content: none !important; display: none !important; }
            .dashboard-runtime {
              background: #121822 !important;
              background-image: none !important;
              box-shadow: none !important;
            }
            .dashboard-runtime .dashboard-widget-cell .dash-wf {
              background: #1a2230 !important;
              background-image: none !important;
            }
          `;
          clonedDoc.head.appendChild(style);
        },
      });
      let dataUrl: string;
      try {
        dataUrl = canvas.toDataURL("image/png");
      } catch (e) {
        console.error("Dashboard screenshot toDataURL failed", e);
        const name = e instanceof Error ? e.name : "";
        const msg = e instanceof Error ? e.message : String(e);
        if (name === "SecurityError" || /taint/i.test(msg)) {
          setShotMsg(
            "Screenshot blocked: map or external images cannot be exported (browser security). Try a layout without a map, or use OS screen capture.",
          );
        } else {
          setShotMsg("Screenshot failed while encoding PNG. See browser console for details.");
        }
        window.setTimeout(() => setShotMsg(null), 7000);
        return;
      }
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${fileBaseName.replace(/[^a-z0-9-_]+/gi, "_")}-${new Date().toISOString().slice(0, 19)}.png`;
      a.click();
      setShotMsg("PNG download started.");
      window.setTimeout(() => setShotMsg(null), 4000);
    } catch (e) {
      console.error("Dashboard screenshot html2canvas failed", e);
      setShotMsg(
        "Screenshot capture failed (layout or styles). Try again, or use OS screen capture. Details in browser console.",
      );
      window.setTimeout(() => setShotMsg(null), 7000);
    } finally {
      setScreenshotBusy(false);
    }
  }, [captureRef, fileBaseName, screenshotBusy]);

  return (
    <div className="dash-live-toolbar">
      <button
        type="button"
        className="dash-btn dash-btn--secondary"
        disabled={screenshotBusy}
        onClick={() => void onScreenshot()}
      >
        Screenshot PNG
      </button>
      <button type="button" className="dash-btn dash-btn--secondary" onClick={onTogglePause}>
        {paused ? "Resume auto-refresh" : "Pause auto-refresh"}
      </button>
      <button type="button" className="dash-btn dash-btn--secondary" onClick={onManualRefresh}>
        Refresh now
      </button>
      <span className="dash-widget__muted" style={{ fontSize: "0.8rem" }}>
        {paused ? "Auto-refresh paused" : `Auto-refresh every ${refreshIntervalSec}s`}
      </span>
      {shotMsg ? (
        <span className="dash-live-toolbar__hint" role="status">
          {shotMsg}
        </span>
      ) : null}
    </div>
  );
}
