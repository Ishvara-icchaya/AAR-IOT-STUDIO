/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_DEBUG?: string;
  /** Optional MapLibre style URL when API does not return `dashboard.settings.map_style_url`. */
  readonly VITE_DASHBOARD_MAP_STYLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
