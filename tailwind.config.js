/** @type {import('tailwindcss').Config} */

// Semantic tokens resolve through CSS custom properties (set at runtime by
// `src/theme/ThemeProvider.tsx` via NativeWind's `vars()`, one value set
// per color scheme — see `src/theme/tokens.ts`), so the same className
// (e.g. `bg-surface`) automatically renders correctly in both light and
// dark mode with no `dark:` variant needed at any of the ~24 call sites
// that use these classes. The `<alpha-value>` placeholder lets Tailwind's
// opacity modifiers (`bg-surface/50`) keep working.
const cssVar = (name) => `rgb(var(${name}) / <alpha-value>)`;

module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: cssVar("--color-bg"),
        surface: {
          DEFAULT: cssVar("--color-surface"),
          alt: cssVar("--color-surface-alt"),
        },
        border: {
          DEFAULT: cssVar("--color-border"),
          subtle: cssVar("--color-border-subtle"),
          strong: cssVar("--color-border-strong"),
        },
        foreground: {
          DEFAULT: cssVar("--color-fg"),
          secondary: cssVar("--color-fg-secondary"),
          tertiary: cssVar("--color-fg-tertiary"),
          muted: cssVar("--color-fg-muted"),
        },
        // Electric Violet — the single hero accent. 50-900 is the static
        // Tailwind `violet` scale (doesn't need to change per theme); the
        // named aliases (DEFAULT/pressed/subtle/disabled) are CSS-var
        // backed because *which* step reads as "the accent" shifts per
        // color scheme to hold WCAG AA text contrast (600 on white,
        // 400 on near-black — see tokens.ts for the computed ratios).
        accent: {
          DEFAULT: cssVar("--color-accent"),
          pressed: cssVar("--color-accent-pressed"),
          subtle: cssVar("--color-accent-subtle"),
          line: cssVar("--color-accent-line"),
          disabled: cssVar("--color-accent-disabled"),
          50: "#F5F3FF",
          100: "#EDE9FE",
          200: "#DDD6FE",
          300: "#C4B5FD",
          400: "#A78BFA",
          500: "#8B5CF6",
          600: "#7C3AED",
          700: "#6D28D9",
          800: "#5B21B6",
          900: "#4C1D95",
        },
        "on-accent": cssVar("--color-on-accent"),
        danger: {
          DEFAULT: cssVar("--color-danger"),
          subtle: cssVar("--color-danger-subtle"),
          line: cssVar("--color-danger-line"),
        },
        success: {
          DEFAULT: cssVar("--color-success"),
          subtle: cssVar("--color-success-subtle"),
          line: cssVar("--color-success-line"),
        },
      },
      // Sharper, TikTok/IG-style corners: fewer steps, smaller values
      // than Tailwind's defaults (lg 8/xl 12/2xl 16px). An override, not
      // a rename, so every pre-existing `rounded-lg`/`rounded-xl`/
      // `rounded-2xl` className needed no edits — only the values
      // they resolve to got smaller.
      borderRadius: {
        none: "0px",
        sm: "4px",
        DEFAULT: "6px",
        md: "6px",
        lg: "8px",
        xl: "10px",
        "2xl": "12px",
        full: "9999px",
      },
    },
  },
  plugins: [],
};
