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

/** Shell footer messages auto-clear after this interval. */
export const SHELL_MESSAGE_TTL_MS = 10_000;

export type ShellMessage = {
  id: string;
  tone: "info" | "success" | "warning" | "error";
  text: string;
};

type ShellMessageContextValue = {
  messages: ShellMessage[];
  pushMessage: (tone: ShellMessage["tone"], text: string) => void;
  dismissMessage: (id: string) => void;
  clearMessages: () => void;
};

const ShellMessageContext = createContext<ShellMessageContextValue | null>(null);

let _seq = 0;
function nextId() {
  _seq += 1;
  return `msg-${_seq}`;
}

export function ShellMessageProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ShellMessage[]>([]);
  const dismissTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    return () => {
      for (const t of dismissTimersRef.current.values()) window.clearTimeout(t);
      dismissTimersRef.current.clear();
    };
  }, []);

  const pushMessage = useCallback((tone: ShellMessage["tone"], text: string) => {
    const id = nextId();
    setMessages((m) => [...m, { id, tone, text }]);
    const t = window.setTimeout(() => {
      dismissTimersRef.current.delete(id);
      setMessages((m) => m.filter((x) => x.id !== id));
    }, SHELL_MESSAGE_TTL_MS);
    dismissTimersRef.current.set(id, t);
  }, []);

  const dismissMessage = useCallback((id: string) => {
    const existing = dismissTimersRef.current.get(id);
    if (existing) {
      window.clearTimeout(existing);
      dismissTimersRef.current.delete(id);
    }
    setMessages((m) => m.filter((x) => x.id !== id));
  }, []);

  const clearMessages = useCallback(() => {
    for (const t of dismissTimersRef.current.values()) window.clearTimeout(t);
    dismissTimersRef.current.clear();
    setMessages([]);
  }, []);

  const value = useMemo(
    () => ({ messages, pushMessage, dismissMessage, clearMessages }),
    [messages, pushMessage, dismissMessage, clearMessages],
  );

  return <ShellMessageContext.Provider value={value}>{children}</ShellMessageContext.Provider>;
}

export function useShellMessage() {
  const ctx = useContext(ShellMessageContext);
  if (!ctx) throw new Error("useShellMessage must be used under ShellMessageProvider");
  return ctx;
}
