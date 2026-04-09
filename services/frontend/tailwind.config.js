import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  important: "#iot-dashboard-root",
  corePlugins: {
    preflight: false,
  },
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--iot-border))",
        input: "hsl(var(--iot-input))",
        ring: "hsl(var(--iot-ring))",
        background: "hsl(var(--iot-background))",
        foreground: "hsl(var(--iot-foreground))",
        primary: {
          DEFAULT: "hsl(var(--iot-primary))",
          foreground: "hsl(var(--iot-primary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--iot-muted))",
          foreground: "hsl(var(--iot-muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--iot-accent))",
          foreground: "hsl(var(--iot-accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--iot-card))",
          foreground: "hsl(var(--iot-card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--iot-radius)",
        md: "calc(var(--iot-radius) - 2px)",
        sm: "calc(var(--iot-radius) - 4px)",
      },
      boxShadow: {
        "glow-cyan": "0 0 24px -4px hsl(187 100% 50% / 0.35), 0 0 0 1px hsl(187 100% 50% / 0.12)",
        "glow-cyan-sm": "0 0 16px -2px hsl(187 100% 45% / 0.25)",
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.65" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
