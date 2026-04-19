import { useCallback, useState, type RefObject } from "react";
import html2canvas from "html2canvas";

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
      const canvas = await html2canvas(el, {
        scale: window.devicePixelRatio > 1 ? 1.5 : 1,
        useCORS: true,
        logging: false,
        backgroundColor: getComputedStyle(document.body).backgroundColor || "#0f1419",
      });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${fileBaseName.replace(/[^a-z0-9-_]+/gi, "_")}-${new Date().toISOString().slice(0, 19)}.png`;
      a.click();
      setShotMsg("PNG download started.");
      window.setTimeout(() => setShotMsg(null), 4000);
    } catch {
      setShotMsg("Screenshot failed — check browser download permissions.");
      window.setTimeout(() => setShotMsg(null), 5000);
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
