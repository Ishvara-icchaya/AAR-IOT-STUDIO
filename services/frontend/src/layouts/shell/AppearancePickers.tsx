import { Palette } from "lucide-react";
import { useEffect, useState } from "react";

const THEME_KEY = "aar-theme";

const THEMES = ["dark", "light", "ocean", "sunset", "neon"] as const;
type ThemeName = (typeof THEMES)[number];

function readTheme(): ThemeName {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (THEMES.includes(v as ThemeName)) return v as ThemeName;
  } catch {
    /* ignore */
  }
  return "dark";
}

/** Color theme selector (persisted). Font family is fixed to app default (see :root --font-family-sans). */
export function AppearancePickers() {
  const [theme, setTheme] = useState<ThemeName>(() => readTheme());

  useEffect(() => {
    document.documentElement.removeAttribute("data-font");
    try {
      localStorage.removeItem("aar-font");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  return (
    <div className="shell-appearance" aria-label="Appearance">
      <label className="shell-appearance__item shell-appearance__item--theme">
        <Palette size={16} strokeWidth={2} className="shell-appearance__theme-icon" aria-hidden />
        <select
          className="shell-appearance__select"
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeName)}
          title="Color theme"
          aria-label="Color theme"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="ocean">Ocean</option>
          <option value="sunset">Sunset</option>
          <option value="neon">Neon</option>
        </select>
      </label>
    </div>
  );
}

/** @deprecated Use AppearancePickers */
export function ThemeToggle() {
  return <AppearancePickers />;
}
