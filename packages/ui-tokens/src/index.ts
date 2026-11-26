// Bibalak design tokens.
//
// The runtime theme is driven by CSS variables in the app's globals.css (the
// shadcn convention), but these tokens are the canonical reference for values
// that live outside CSS — e.g. chart series colors (Recharts), canvas drawing,
// or a future native mobile UI that cannot read the web CSS variables.

/** Brand accent ramp (terracotta — the warm "study lamp" signal). 500 = light-theme primary. */
export const brand = {
  50: "#fcf3ee",
  100: "#f8e2d6",
  200: "#f0c3ab",
  300: "#e59c79",
  400: "#d9774e",
  500: "#ba542c",
  600: "#9e4523",
  700: "#80381e",
  800: "#652d19",
  900: "#4d2415",
} as const;

/** Semantic review-state colors (light theme values of --again/--hard/--good/--easy). */
export const semantic = {
  again: "#c02a3e",
  hard: "#a3570a",
  good: "#21734d",
  easy: "#1f6bad",
  info: brand[500],
} as const;

/** Border radius scale (px). Mirrors the `--radius` CSS variable (14px). */
export const radii = {
  sm: 10,
  md: 12,
  lg: 14,
  xl: 18,
} as const;

/** Motion: durations (ms) and easing curves. Animations must never block input. */
export const motion = {
  duration: { fast: 120, base: 180, slow: 280 },
  easing: {
    standard: [0.2, 0, 0, 1] as const,
    emphasized: [0.3, 0, 0, 1] as const,
  },
} as const;

/** Ordered palette for chart series (heatmaps, retention, forecast). */
export const chartSeries = [
  "#2c77ba",
  "#238575",
  "#cb850b",
  "#3a7731",
  "#814f92",
  "#cf3046",
] as const;

/** Game style ("Guild Hall") token reference for non-CSS consumers. */
export const gameStyleTokens = {
  radius: 10,
  light: {
    background: "245 30% 96%",
    foreground: "240 28% 15%",
    card: "245 45% 99%",
    primary: "262 66% 47%",
    gold: "36 90% 30%",
    xp: "158 64% 30%",
    freeze: "198 80% 31%",
  },
  dark: {
    background: "244 26% 10%",
    foreground: "240 20% 92%",
    card: "244 24% 14%",
    primary: "262 80% 74%",
    gold: "43 92% 58%",
    xp: "158 70% 56%",
    freeze: "196 80% 62%",
  },
} as const;
