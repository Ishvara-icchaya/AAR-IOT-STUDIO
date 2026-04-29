import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Browser hits same-origin `/api/...`; Vite forwards to the real API (avoids CORS + wrong host:8000 from LAN). */
const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("mapbox") ||
            id.includes("maplibre") ||
            id.includes("deck.gl") ||
            id.includes("@deck.gl") ||
            id.includes("supercluster")
          ) {
            return "vendor-map";
          }
          if (id.includes("echarts")) {
            return "vendor-echarts";
          }
          if (id.includes("ag-grid")) {
            return "vendor-ag-grid";
          }
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          /** No catch-all `vendor` bucket — avoids circular chunk graphs. */
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: devProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
