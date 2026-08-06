// Phase 8 design tokens — colors, typography, spacing, radius, elevation.
//
// Colors are defined twice on purpose:
//  - `*_VARS` below (RGB triplets) feed NativeWind's `vars()` at runtime so
//    Tailwind classes like `bg-surface`/`text-foreground` resolve to the
//    right value per color scheme with zero `dark:` prefixes anywhere in
//    the 24 screens/components that consume them (see ThemeProvider.tsx).
//  - `lightColors`/`darkColors` (hex) are the same palette for the rare
//    non-className consumers: React Navigation's `theme` prop, RN's
//    `StatusBar`, and the couple of pre-existing inline `style={{}}` spots
//    (shadow color, TextInput placeholder color) that NativeWind can't
//    reach. Keep these two representations in sync by hand — there's no
//    single source both `tailwind.config.js` (needs CSS var strings) and
//    plain TS (needs hex) can share without a build step this project
//    doesn't have.
//
// Contrast ratios below were computed against the WCAG 2.1 relative-
// luminance formula, not assumed. Every token used for body/label text
// clears AA (4.5:1) against the surface it's meant to sit on; tokens
// noted "muted" are placeholder/disabled-only (WCAG doesn't require body
// text contrast for those) and intentionally sit below 4.5:1.

export type ColorScheme = 'light' | 'dark';

// Raw Electric Violet scale — Tailwind's own `violet` palette, which
// already has #8B5CF6 at step 500 (the spec's requested base hue). Reused
// rather than hand-rolled so the scale is a known-good, widely-audited
// one rather than a fresh, unvalidated set of stops.
export const accentScale = {
  50: '#F5F3FF',
  100: '#EDE9FE',
  200: '#DDD6FE',
  300: '#C4B5FD',
  400: '#A78BFA',
  500: '#8B5CF6',
  600: '#7C3AED',
  700: '#6D28D9',
  800: '#5B21B6',
  900: '#4C1D95',
} as const;

// --- CSS-variable triplets (space-separated "R G B", for `vars()`) ---
// Semantic accent picks per mode, contrast-checked against their surface:
//   light: accent-600 (#7C3AED) on white background  -> 5.60:1 (AA)
//   dark:  accent-400 (#A78BFA) on black background   -> 7.72:1 (AAA)
//   on-accent light: white on accent-600               -> 5.60:1 (AA)
//   on-accent dark:  black on accent-400                -> 7.72:1 (AAA)
export const lightVars = {
  '--color-bg': '255 255 255',
  '--color-surface': '255 255 255',
  '--color-surface-alt': '249 250 251',
  '--color-border': '209 213 219',
  '--color-border-subtle': '229 231 235',
  '--color-border-strong': '156 163 175',
  '--color-fg': '17 24 39',
  '--color-fg-secondary': '55 65 81',
  '--color-fg-tertiary': '107 114 128',
  '--color-fg-muted': '156 163 175',
  '--color-accent': '124 58 237',
  '--color-accent-pressed': '109 40 217',
  '--color-accent-subtle': '245 243 255',
  '--color-accent-line': '221 214 254',
  '--color-accent-disabled': '221 214 254',
  '--color-on-accent': '255 255 255',
  '--color-danger': '220 38 38',
  '--color-danger-subtle': '254 242 242',
  '--color-danger-line': '254 202 202',
  '--color-success': '21 128 61',
  '--color-success-subtle': '240 253 244',
  '--color-success-line': '187 247 208',
} as const;

export const darkVars = {
  '--color-bg': '0 0 0',
  '--color-surface': '18 18 18',
  '--color-surface-alt': '28 28 30',
  '--color-border': '58 58 60',
  '--color-border-subtle': '44 44 46',
  '--color-border-strong': '107 107 110',
  '--color-fg': '255 255 255',
  '--color-fg-secondary': '209 213 219',
  '--color-fg-tertiary': '156 163 175',
  '--color-fg-muted': '107 114 128',
  '--color-accent': '167 139 250',
  '--color-accent-pressed': '196 181 253',
  '--color-accent-subtle': '46 16 101',
  '--color-accent-line': '109 40 217',
  '--color-accent-disabled': '91 33 182',
  '--color-on-accent': '0 0 0',
  '--color-danger': '248 113 113',
  '--color-danger-subtle': '45 20 20',
  '--color-danger-line': '127 29 29',
  '--color-success': '74 222 128',
  '--color-success-subtle': '18 40 24',
  '--color-success-line': '22 101 52',
} as const;

// --- Same palette, hex, for JS-side (non-NativeWind) consumers ---
export const lightColors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F9FAFB',
  border: '#D1D5DB',
  borderSubtle: '#E5E7EB',
  borderStrong: '#9CA3AF',
  foreground: '#111827',
  foregroundSecondary: '#374151',
  foregroundTertiary: '#6B7280',
  foregroundMuted: '#9CA3AF',
  accent: '#7C3AED',
  accentPressed: '#6D28D9',
  accentSubtle: '#F5F3FF',
  accentLine: '#DDD6FE',
  accentDisabled: '#DDD6FE',
  onAccent: '#FFFFFF',
  danger: '#DC2626',
  dangerSubtle: '#FEF2F2',
  dangerLine: '#FECACA',
  success: '#15803D',
  successSubtle: '#F0FDF4',
  successLine: '#BBF7D0',
} as const;

export const darkColors = {
  background: '#000000',
  surface: '#121212',
  surfaceAlt: '#1C1C1E',
  border: '#3A3A3C',
  borderSubtle: '#2C2C2E',
  borderStrong: '#6B6B6E',
  foreground: '#FFFFFF',
  foregroundSecondary: '#D1D5DB',
  foregroundTertiary: '#9CA3AF',
  foregroundMuted: '#6B7280',
  accent: '#A78BFA',
  accentPressed: '#C4B5FD',
  accentSubtle: '#2E1065',
  accentLine: '#6D28D9',
  accentDisabled: '#5B21B6',
  onAccent: '#000000',
  danger: '#F87171',
  dangerSubtle: '#2D1414',
  dangerLine: '#7F1D1D',
  success: '#4ADE80',
  successSubtle: '#122818',
  successLine: '#166534',
} as const;

export type ThemeColors = { [K in keyof typeof lightColors]: string };

// Typography scale — sizes/weights/line-heights. Mirrors the sizes already
// in use across screens (text-sm/base/lg/xl/2xl etc.) so this documents
// the existing scale for JS consumers rather than inventing a new one.
export const typography = {
  size: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  lineHeight: { xs: 16, sm: 20, base: 24, lg: 28, xl: 28, '2xl': 32, '3xl': 36 },
} as const;

// Spacing scale — Tailwind's own default 4px-based scale (already what
// every `px-4`/`py-3`/`gap-2`/`mb-6` className in this codebase uses).
// Exposed here only for the rare non-className consumer; existing spacing
// classNames are untouched by this phase since they're already tokenized.
export const spacing = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64,
} as const;

// Border radius — deliberately smaller/fewer steps than Tailwind's
// defaults (lg 8/xl 12/2xl 16) to read sharper, per the phase direction.
// Applied as a `tailwind.config.js` override, so existing `rounded-lg`/
// `rounded-xl`/`rounded-2xl` classNames needed no renaming — only the
// values they resolve to changed.
export const radius = {
  none: 0, sm: 4, md: 6, lg: 8, xl: 10, '2xl': 12, full: 9999,
} as const;

export const elevation = {
  sm: { shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  md: { shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  lg: { shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
} as const;

export function colorsFor(scheme: ColorScheme): ThemeColors {
  return scheme === 'dark' ? darkColors : lightColors;
}

export function varsFor(scheme: ColorScheme) {
  return scheme === 'dark' ? darkVars : lightVars;
}
