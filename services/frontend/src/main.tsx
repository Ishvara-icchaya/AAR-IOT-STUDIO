import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthContext";
import App from "./App";
import { dbg } from "./lib/debug";
import "./index.css";
import "./styles/ops-theme.css";

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
