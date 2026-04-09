import { useEffect, useState } from "react";

const THEME_KEY = "aar-theme";
const FONT_KEY = "aar-font";

const THEMES = ["dark", "light", "ocean", "sunset", "neon"] as const;
type ThemeName = (typeof THEMES)[number];

const FONTS = ["default", "inter", "source", "serif", "mono"] as const;
type FontName = (typeof FONTS)[number];

function readTheme(): ThemeName {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (THEMES.includes(v as ThemeName)) return v as ThemeName;
  } catch {
    /* ignore */
  }
  return "dark";
}

function readFont(): FontName {
  try {
    const v = localStorage.getItem(FONT_KEY);
    if (FONTS.includes(v as FontName)) return v as FontName;
  } catch {
    /* ignore */
  }
  return "default";
}

/** Compact theme + font dropdowns (persisted). */
export function AppearancePickers() {
  const [theme, setTheme] = useState<ThemeName>(() => readTheme());
  const [font, setFont] = useState<FontName>(() => readFont());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.font = font;
    try {
      localStorage.setItem(FONT_KEY, font);
    } catch {
      /* ignore */
    }
  }, [font]);

  return (
    <div className="shell-appearance" aria-label="Appearance">
      <label className="shell-appearance__item">
        <span className="shell-appearance__label">Theme</span>
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
      <label className="shell-appearance__item">
        <span className="shell-appearance__label">Font</span>
        <select
          className="shell-appearance__select"
          value={font}
          onChange={(e) => setFont(e.target.value as FontName)}
          title="UI font"
          aria-label="UI font"
        >
          <option value="default">Aptos / system</option>
          <option value="inter">Inter</option>
          <option value="source">Source Sans 3</option>
          <option value="serif">Serif</option>
          <option value="mono">Monospace</option>
        </select>
      </label>
    </div>
  );
}

/** @deprecated Use AppearancePickers */
export function ThemeToggle() {
  return <AppearancePickers />;
}
