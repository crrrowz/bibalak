---
name: Bibalak
description: An Anki-compatible spaced-repetition study app with a warm, calm, dependable desktop feel.
colors:
  primary: "#BA542C"
  primary-dark: "#E5885D"
  background: "#FAF8F5"
  background-dark: "#171412"
  foreground: "#26201C"
  foreground-dark: "#EBE7E0"
  border: "#E5DFD7"
  muted-foreground: "#6F655D"
  again: "#C02A3E"
  hard: "#A3570A"
  good: "#21734D"
  easy: "#1F6BAD"
  chart-1-blue: "#2C77BA"
  chart-2-teal: "#238575"
  chart-3-honey: "#CB850B"
  chart-4-olive: "#3A7731"
  chart-5-plum: "#814F92"
  chart-6-crimson: "#CF3046"
typography:
  body:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "1.5"
    letterSpacing: "normal"
  headline:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 2vw, 1.75rem)"
    fontWeight: 650
    lineHeight: "1.2"
    letterSpacing: "-0.015em"
  label:
    fontFamily: "Figtree Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "1.3"
    letterSpacing: "normal"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "1.4"
rounded:
  sm: "10px"
  md: "12px"
  lg: "14px"
  xl: "18px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFCF9"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "#EFE9E1"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  card:
    backgroundColor: "#FFFEFC"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input:
    backgroundColor: "#FFFEFC"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
---

# Design System: Bibalak

## 1. Overview

**Creative North Star: "The Study Lamp"**

Bibalak should feel like a desk lamp switched on for a long evening of study:
warm paper, soft light, nothing shouting. Warmth comes from the neutrals (paper
cream by day, walnut brown at night) and from one terracotta signal. Precision
stays: tight hierarchy, consistent spacing, immediate feedback. The warmth is
in the materials, not in decoration.

It rejects Anki's cluttered, dated interface and, equally, gamified study apps:
no mascots, no confetti, no streak pressure. Friendly means comfortable and
dependable, not cute. Progress (XP, level, gold) is shown in every style; in
this Default style it is quiet: numbers and bars, no celebration. The opt-in
Game style has its own visual rules, added to this file when it is built.

**Key characteristics:**

- One terracotta signal (`#BA542C` light / `#E5885D` dark) for interactive and primary state
- Warm, low-chroma neutrals in both themes (paper cream / walnut), never cold blue-gray
- Softer geometry than a pro tool: 10–18px radii, rounded but never pill-shaped
- Fixed-meaning review colors (again / hard / good / easy) tuned for AA contrast with white labels
- Structural glass only where content scrolls under fixed chrome

## 2. Colors

All theme colors live as HSL tokens in `src/styles/globals.css` (`:root` and
`.dark`); `packages/ui-tokens` mirrors them for code that cannot read CSS.
`src/test/themeContrast.test.ts` enforces WCAG AA for the text pairs and the
review buttons in both themes; keep it green when changing a token.

### Primary

- **Lamp Terracotta** (`#BA542C` light / `#E5885D` dark): primary buttons,
  active navigation, focus rings, links, the activity heatmap ramp. Lightened in
  dark mode for legibility, with dark text on it.

### Neutral

- **Paper / Walnut** (`#FAF8F5` background light / `#171412` dark): the shell.
- **Ink** (`#26201C` light / `#EBE7E0` dark): body and heading text.
- **Seam** (`#E5DFD7` light): borders and dividers, always quiet.
- **Pencil** (`#6F655D`): secondary text, timestamps, helper copy.

### Semantic (review state, fixed, never reassigned)

- **Again** (`#C02A3E`, crimson): failed recall. Deliberately crimson, not
  orange-red, so it never reads as the terracotta primary.
- **Hard** (`#A3570A`, deep amber): recalled with difficulty.
- **Good** (`#21734D`, forest green): recalled correctly.
- **Easy** (`#1F6BAD`, deep blue): recalled with no effort.

Each keeps at least 4.5:1 contrast against its white label.

### Named rules

**The One Signal Rule.** Terracotta is the only brand color and means
"interactive or primary". It is never a background wash or a gradient.

**The Fixed Palette Rule.** Review colors and chart series (chart-1..6) are
assigned by role, never by index or filter state.

**Status colors are separate.** Anki flag colors (red/orange/green/blue), the
New/Learn/Due count badges and success messages keep their conventional
Tailwind hues with light/dark variants; they are state, not brand.

## 3. Typography

**Font:** Figtree (variable, bundled via `@fontsource-variable/figtree`, OFL),
falling back to the system UI font. Mono for numbers that must align.

**Character:** open, rounded, friendly letterforms that stay crisp at 12–14px.
One family carries every role through weight and size.

- **Headline** (650, `clamp(1.25rem, 2vw, 1.75rem)`, -0.015em)
- **Body** (400, 14px, 1.5)
- **Label** (500, 12px, 1.3)
- **Mono/Numeric** (400, 13px, tabular-nums)

**Arabic:** IBM Plex Sans Arabic (Arabic subset, weights 400–700, OFL) sits
after Figtree in the font stack, so Latin glyphs stay Figtree and Arabic glyphs
fall through to Plex: one family per script. Card frames keep only Figtree and
use the system Arabic font for card content (keeps each frame ~200 KB lighter).

**RTL:** Arabic sets `<html dir="rtl">`. Layout uses logical utilities only
(`ms/me/ps/pe/start/end`, `text-start/end`, `border-s/e`); directional icons
(chevrons, arrows, panel) carry `rtl:-scale-x-100`. Code-like content (template
and CSS editors, query syntax) stays `dir="ltr"`; card content uses
`dir="auto"` so each card follows its own language.
`src/test/i18nGuards.test.ts` fails on physical left/right classes and on
hard-coded UI text.

## 4. Elevation

Flat at rest. Depth comes from structural glass where content scrolls under
fixed UI, using the warm surface tokens:

- **Glass chrome** (`blur(16px) saturate(1.4)` over `--glass-chrome-bg`): title bar, sidebar, sticky headers.
- **Glass panel** (`blur(24px) saturate(1.5)` over `--glass-panel-bg`): palette, dialogs, popovers, study HUD.
- Both fall back to solid surfaces without `backdrop-filter`.

The focus-mode vignette (background fading to itself) remains the one
sanctioned gradient.

## 5. Components

- **Buttons:** `12px` radius, terracotta primary with near-white text, warm
  secondary fill; hover steps the fill, focus shows a 2px terracotta ring.
- **Cards / containers:** `14px` radius, `--card` surface, hairline `--border`,
  no shadow. The study card frame and the rendered card face share the same
  `--card` surface.
- **Inputs:** hairline border, `12px` radius, ring color on focus.
- **Navigation:** glass sidebar; active item uses the accent fill and full ink.
- **Review answer buttons (signature):** solid semantic fills with white labels,
  the one place color is loud, because speed matters there.

## 6. Logo

`public/logos/bibalak-icon.svg` is the master: two stacked cards with a
bookmark ribbon on a terracotta tile, "something you keep". The same
full-color mark is used in light and dark themes. Platform icons are generated
from it:

```sh
pnpm --filter @bibalak/desktop tauri icon public/logos/bibalak-icon.svg -o src-tauri/icons
```

## 7. Do's and don'ts

### Do

- Use terracotta only for interactive/primary state.
- Keep neutrals warm in both themes.
- Keep motion fast (120–280ms) and honor `prefers-reduced-motion`.
- Run the contrast test after any token change.

### Don't

- Don't use cold blue-gray surfaces or indigo accents (the previous identity).
- Don't add mascots, confetti or streak guilt to the Default style (the opt-in Game style is the only place for game visuals).
- Don't use emoji as icons; use the SVG icon set.
- Don't use pill-shaped buttons or drop shadows on cards at rest.
- Don't use gradient text or a second typeface within one script.
- Don't put terracotta and crimson side by side as equals; crimson means "Again".

## 8. Presentation styles

Bibalak ships with `data-style="default"` and `data-style="scholar"` on `<html>` (stored per device in `keepsake-style`). Styles change presentation only, never points or scheduling rules.

- **Scholar (`[data-style="scholar"]` and `[data-style="scholar"].dark`):** Classic library palette overriding surface, ink, border, and primary tokens (paper `#F6F1E6` / deep ink `#141820`, card `#FBF8F1` / `#1C2230`, ink `#1F2A3A` / `#E8E2D6`, navy primary `#22406B` / `#8FB0DD`, border `#DDD3C2`), `--radius: 0.5rem` (`8px`), and thin bottom rule lines under section headings. The burgundy accent (`#7A2E3A` light / `#D89AA5` dark) lives in `--scholar-accent` so `--accent` remains a safe hover fill for `hover:bg-accent hover:text-foreground`.
- **Scholar headings only:** `h1`–`h3` and `.screen-title` use **Literata Variable** (Latin, `@fontsource-variable/literata`, OFL-1.1) and **Amiri** (Arabic, `@fontsource/amiri` weights 400/700, OFL-1.1). Body text stays Figtree / IBM Plex Sans Arabic.
- **Scholar extras (P2):** Promotion certificates use a thin double border, the Bibalak mark, and a fade-only dialog (`prefers-reduced-motion` honored, no confetti/sound); the `/transcript` page presents per-course deck rollups, earned certificate dates, and the 30-day lecture log using `.scholar-heading-rule` headings.
- **Never overridden:** Review rating colors (`--again`, `--hard`, `--good`, `--easy`), `--destructive`, focus rings (`--ring`), chart series (`--chart-1..6`), and the sandboxed `CardFace` iframe (`ADR-004`).
