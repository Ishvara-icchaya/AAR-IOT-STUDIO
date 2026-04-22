import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type DashboardResizeSnapshot = {
  width: number;
  height: number;
};

const DashboardResizeContext = createContext<DashboardResizeSnapshot | null>(null);

export function useDashboardResize(): DashboardResizeSnapshot | null {
  return useContext(DashboardResizeContext);
}

type Props = {
  children: ReactNode;
  className?: string;
  debounceMs?: number;
};

/**
 * Provides debounced width/height of the dashboard viewport for widgets that
 * want to coordinate resize without per-widget observers everywhere.
 */
export function DashboardResizeManager({ children, className, debounceMs = 80 }: Props) {
  const localRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<DashboardResizeSnapshot>({ width: 0, height: 0 });

  const schedule = useRef<number | undefined>(undefined);
  const onResize = useCallback(
    (w: number, h: number) => {
      if (schedule.current !== undefined) window.clearTimeout(schedule.current);
      schedule.current = window.setTimeout(() => {
        setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }, debounceMs);
    },
    [debounceMs],
  );

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      const { width, height } = e.contentRect;
      onResize(width, height);
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    onResize(r.width, r.height);
    return () => {
      if (schedule.current !== undefined) window.clearTimeout(schedule.current);
      ro.disconnect();
    };
  }, [onResize]);

  const value = useMemo(() => size, [size]);

  return (
    <DashboardResizeContext.Provider value={value}>
      <div ref={localRef} className={["dashboard-resize-root", className].filter(Boolean).join(" ")}>
        {children}
      </div>
    </DashboardResizeContext.Provider>
  );
}
