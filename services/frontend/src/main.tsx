import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthContext";
import App from "./App";
import { dbg } from "./lib/debug";
import "./styles/design-tokens.css";
import "./components/system/aar-components.css";
import "./index.css";
import "./styles/design-system.css";
import "./styles/ops-theme.css";

/** App is dark-only; ignore any legacy persisted theme. */
document.documentElement.dataset.theme = "dark";
try {
  localStorage.setItem("aar-theme", "dark");
} catch {
  /* ignore */
}

dbg("main.tsx bootstrap", { api: import.meta.env.VITE_API_BASE_URL, dev: import.meta.env.DEV });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
