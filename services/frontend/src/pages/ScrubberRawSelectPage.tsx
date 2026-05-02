import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { PageStatus } from "@/components/PageStatus";
import { ScrubberRawSelectModal } from "@/pages/scrubber2/ScrubberRawSelectModal";
import { Scrubber2Shell } from "@/pages/scrubber2/Scrubber2Shell";
import "@/pages/scrubber2/scrubber2.css";

/**
 * Entry point from main nav (“Raw sample”). Opens the shared modal; closing returns to Scrubber Pipelines.
 * Optional query: `?deviceId=` to pick a device; otherwise the first registered device is used (no dropdown in the modal).
 */
export function ScrubberRawSelectPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(true);
  const [ctx, setCtx] = useState<{ id: string; name: string } | null>(null);
  const [ctxErr, setCtxErr] = useState<string | null>(null);
  const [ctxLoading, setCtxLoading] = useState(true);

  useEffect(() => {
    const wanted = searchParams.get("deviceId")?.trim() ?? "";
    let cancelled = false;
    void (async () => {
      setCtxLoading(true);
      setCtxErr(null);
      try {
        const d = await apiFetch<{ items: { id: string; name: string }[] }>("/devices");
        if (cancelled) return;
        const items = d?.items ?? [];
        if (!items.length) {
          setCtx(null);
          setCtxErr("No devices registered.");
          return;
        }
        const hit = wanted ? items.find((x) => x.id === wanted) : undefined;
        const pick = hit ?? items[0];
        setCtx({ id: pick.id, name: pick.name });
      } catch (e) {
        if (!cancelled) {
          setCtxErr(e instanceof Error ? e.message : "Failed to load devices");
          setCtx(null);
        }
      } finally {
        if (!cancelled) setCtxLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  return (
    <>
      <Scrubber2Shell>
        <nav className="scrubber2-subnav" aria-label="Raw sample">
          <button
            type="button"
            className="scrubber2-subnav__back"
            onClick={() => navigate("/scrubber/v2/pipelines")}
            style={{ border: "none", background: "none", font: "inherit", padding: 0, cursor: "pointer" }}
          >
            <ArrowLeft size={16} strokeWidth={2} aria-hidden />
            Scrubber Pipelines
          </button>
          <span className="scrubber2-subnav__sep" aria-hidden>
            /
          </span>
          <span className="scrubber2-subnav__current">Raw sample</span>
        </nav>
        <p className="scrubber2-muted" style={{ fontSize: "0.82rem", marginTop: 0 }}>
          {ctxLoading
            ? "Resolving device context…"
            : ctx
              ? `Showing archives for ${ctx.name}. Add ?deviceId= to the URL to choose another device.`
              : "Open Raw sample from the pipeline editor for a device-specific view, or register a device first."}
        </p>
        {ctxErr ? <PageStatus variant="error">{ctxErr}</PageStatus> : null}
      </Scrubber2Shell>
      {ctx ? (
        <ScrubberRawSelectModal
          open={open}
          onClose={() => {
            setOpen(false);
            navigate("/scrubber/v2/pipelines");
          }}
          deviceId={ctx.id}
          deviceName={ctx.name}
        />
      ) : null}
    </>
  );
}
