/** Decorative SVG for the sign-in page (theme-aware via CSS variables). */

export function LoginHeroGraphic() {
  return (
    <svg
      className="login-hero-svg"
      viewBox="0 0 520 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="login-hero-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.45" />
          <stop offset="55%" stopColor="var(--color-accent-muted)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="login-hero-stroke" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-accent-muted)" stopOpacity="0.12" />
        </linearGradient>
        <filter id="login-hero-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Soft ambient shapes */}
      <ellipse cx="120" cy="320" rx="180" ry="90" fill="url(#login-hero-grad)" opacity="0.5" />
      <ellipse cx="420" cy="80" rx="140" ry="70" fill="url(#login-hero-grad)" opacity="0.35" />

      {/* Connection lines */}
      <path
        d="M260 200 L140 120 M260 200 L380 120 M260 200 L120 260 M260 200 L400 260 M260 200 L260 340"
        stroke="url(#login-hero-stroke)"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M260 200 C200 160 200 240 140 120 M260 200 C320 160 320 240 380 120 M260 200 C180 220 160 200 120 260 M260 200 C340 220 360 200 400 260"
        stroke="url(#login-hero-stroke)"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.45"
      />

      {/* Hub */}
      <circle cx="260" cy="200" r="44" fill="var(--color-surface-elevated)" opacity="0.92" />
      <circle
        cx="260"
        cy="200"
        r="44"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        strokeOpacity="0.55"
        filter="url(#login-hero-glow)"
      />
      <circle cx="260" cy="200" r="12" fill="var(--color-accent)" opacity="0.85" />

      {/* Satellite nodes — devices / data points */}
      <g opacity="0.95">
        <rect x="100" y="96" width="56" height="40" rx="8" stroke="var(--color-accent)" strokeWidth="1.25" strokeOpacity="0.5" fill="var(--color-surface)" />
        <path d="M116 116h24" stroke="var(--color-text-muted)" strokeWidth="1" strokeOpacity="0.5" strokeLinecap="round" />
        <path d="M116 108h16" stroke="var(--color-text-muted)" strokeWidth="1" strokeOpacity="0.35" strokeLinecap="round" />

        <rect x="364" y="96" width="56" height="40" rx="8" stroke="var(--color-accent)" strokeWidth="1.25" strokeOpacity="0.5" fill="var(--color-surface)" />
        <circle cx="392" cy="116" r="4" fill="var(--color-accent)" opacity="0.65" />

        <rect x="72" y="236" width="52" height="52" rx="10" stroke="var(--color-accent)" strokeWidth="1.25" strokeOpacity="0.45" fill="var(--color-surface)" />
        <rect x="86" y="252" width="24" height="20" rx="2" stroke="var(--color-text-muted)" strokeWidth="1" strokeOpacity="0.4" fill="none" />

        <rect x="396" y="236" width="52" height="52" rx="10" stroke="var(--color-accent)" strokeWidth="1.25" strokeOpacity="0.45" fill="var(--color-surface)" />
        <path d="M412 252l8 8 8-8M412 268h16" stroke="var(--color-text-muted)" strokeWidth="1.25" strokeOpacity="0.45" strokeLinecap="round" />

        <rect x="228" y="312" width="64" height="36" rx="8" stroke="var(--color-accent)" strokeWidth="1.25" strokeOpacity="0.5" fill="var(--color-surface)" />
        <path d="M244 328h32" stroke="var(--color-accent)" strokeWidth="2" strokeOpacity="0.35" strokeLinecap="round" />
      </g>

      {/* Floating data ticks */}
      <g opacity="0.6" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round">
        <path d="M48 180h10M48 200h16M48 220h8" />
        <path d="M472 200h-10M472 220h-16M472 240h-8" />
      </g>
    </svg>
  );
}
