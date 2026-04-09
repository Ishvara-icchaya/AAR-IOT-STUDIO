/** Client debug traces when VITE_DEBUG=true (see docker-compose.debug.yml / run.sh debug). */

export const debugEnabled =
  import.meta.env.DEV && String(import.meta.env.VITE_DEBUG ?? "").toLowerCase() === "true";

/** Send X-Trace-Id on API calls (debug compose sets VITE_AAR_TRACE=true). Never log tokens in dbg(). */
export const traceHeadersEnabled =
  String(import.meta.env.VITE_AAR_TRACE ?? "").toLowerCase() === "true";

export function dbg(...args: unknown[]) {
  if (debugEnabled) {
    console.debug("[aar]", ...args);
  }
}
