import { useCallback, useRef, type RefObject } from "react";
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
  const busy = useRef(false);

  const onScreenshot = useCallback(async () => {
    const el = captureRef.current;
    if (!el || busy.current) return;
    busy.current = true;
    try {
      const canvas = await html2canvas(el, {
        scale: window.devicePixelRatio > 1 ? 1.5 : 1,
        useCORS: true,
        logging: false,
        backgroundColor: "#0f1419",
      });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${fileBaseName.replace(/[^a-z0-9-_]+/gi, "_")}-${new Date().toISOString().slice(0, 19)}.png`;
      a.click();
    } catch {
      /* ignore */
    } finally {
      busy.current = false;
    }
  }, [captureRef, fileBaseName]);

  return (
    <div
      className="dash-live-toolbar"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        alignItems: "center",
        marginBottom: "0.75rem",
      }}
    >
      <button type="button" className="dash-btn dash-btn--secondary" onClick={() => void onScreenshot()}>
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
    </div>
  );
}
