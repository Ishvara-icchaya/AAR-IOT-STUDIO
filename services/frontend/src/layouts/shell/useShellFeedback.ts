import { useEffect, useRef } from "react";
import { useShellMessage } from "./ShellMessageContext";

/**
 * Mirrors page-level `err` / `ok` strings into the shell message bar (dedupes while the same value is held).
 */
export function useShellFeedback(err: string | null, ok: string | null) {
  const { pushMessage } = useShellMessage();
  const lastErr = useRef<string | null>(null);
  const lastOk = useRef<string | null>(null);

  useEffect(() => {
    if (err && err !== lastErr.current) {
      pushMessage("error", err);
      lastErr.current = err;
    }
    if (!err) lastErr.current = null;
  }, [err, pushMessage]);

  useEffect(() => {
    if (ok && ok !== lastOk.current) {
      pushMessage("success", ok);
      lastOk.current = ok;
    }
    if (!ok) lastOk.current = null;
  }, [ok, pushMessage]);
}
