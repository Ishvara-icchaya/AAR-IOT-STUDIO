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
        onclone(clonedDoc, clonedEl) {
          /* html2canvas 1.4 cannot parse oklab()/color-mix() inside gradients anywhere in the subtree. */
          const rid = `dash-screenshot-${Math.random().toString(36).slice(2, 11)}`;
          clonedEl.setAttribute("data-dash-screenshot-root", rid);
          const style = clonedDoc.createElement("style");
          style.setAttribute("data-dashboard-screenshot", "1");
          const root = `[data-dash-screenshot-root="${rid}"]`;
          style.textContent = `
            ${root}, ${root} *, ${root} *::before, ${root} *::after {
              background-image: none !important;
              -webkit-mask-image: none !important;
              mask-image: none !important;
              border-image: none !important;
              filter: none !important;
              backdrop-filter: none !important;
            }
            ${root} .dashboard-runtime::before {
              content: none !important;
              display: none !important;
            }
            ${root} .dashboard-runtime {
              background-color: #121822 !important;
              background: #121822 !important;
              box-shadow: none !important;
            }
            ${root} .dashboard-widget-cell .dash-wf {
              background-color: #1a2230 !important;
              background: #1a2230 !important;
              box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35) !important;
            }
          `;
          clonedDoc.head.appendChild(style);
          clonedEl.querySelectorAll("[style]").forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            const s = node.getAttribute("style") ?? "";
            if (/oklab|oklch|color-mix|lab\(|lch\(/i.test(s)) node.removeAttribute("style");
          });
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
