import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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

  const pushMessage = useCallback((tone: ShellMessage["tone"], text: string) => {
    const id = nextId();
    setMessages((m) => [...m, { id, tone, text }]);
  }, []);

  const dismissMessage = useCallback((id: string) => {
    setMessages((m) => m.filter((x) => x.id !== id));
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

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
