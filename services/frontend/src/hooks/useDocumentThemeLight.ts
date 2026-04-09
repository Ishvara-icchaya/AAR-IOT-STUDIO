import { useEffect, useState } from "react";

/**
 * True when `document.documentElement.dataset.theme === "light"`.
 * Used for embedded UIs (e.g. React Flow) that need an explicit light/dark canvas mode.
 */
export function useDocumentThemeLight(): boolean {
  const [light, setLight] = useState(() => document.documentElement.dataset.theme === "light");
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setLight(el.dataset.theme === "light");
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return light;
}
