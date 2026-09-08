import type { CSSProperties } from 'react';
import { getBlinkoEndpoint } from './blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';

// CUSTOM-JOURNAL: standalone-uploaded images (background/cover images, not
// attached to any note) 401 from the file-serving route
// (server/routerExpress/file/file.ts) unless a token is present - the route
// allows unauthenticated access only for attachments belonging to a *shared*
// note, and a standalone upload has no note attachment at all. A CSS
// `background-image: url()` or plain <img src> never sends the Authorization
// header axios attaches for XHR calls, so these need the token as a
// `?token=` query param instead - the same fallback getTokenFromRequest
// already supports server-side, and the pattern already used elsewhere in
// this app (see app/src/components/Common/AttachmentRender/imageRender.tsx).
export function getAuthenticatedImageUrl(path: string): string {
  const token = RootStore.Get(UserStore).tokenData.value?.token;
  const url = getBlinkoEndpoint(path);
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

// CUSTOM-JOURNAL: shared types/constants for background/font styling and
// per-entry cover images. See docs/workstreams/09-entry-personalization.md
// for the original research.
//
// Revision history worth knowing if you're reading this after another round
// of feedback:
// - Color used to be one of four mutually-exclusive background *types*
//   (pattern OR color OR gradient OR image) with patterns baked to a single
//   fixed texture color per app theme. Reworked so pattern and color are
//   independent: 'pattern' type always carries its own `color` (a preset key
//   OR any custom hex from a native color picker), and the pattern texture's
//   own tint is derived from that chosen color's luminance rather than the
//   app theme - so a pattern looks right no matter which color (preset or
//   fully custom) it's paired with, not just the two app-theme states.
// - "Entry theme" (background + font) is a SINGLE GLOBAL, account-synced
//   setting (config.entryTheme), not a per-note choice - the user wants one
//   theme applied consistently everywhere they compose/read an entry, on any
//   device, same as the pageBackground setting. Only the cover photo
//   (EntryPersonalization.coverImagePath) stays genuinely per-entry, since
//   that's a distinct photo attached to one specific entry, not a styling
//   choice. EntryTheme used to live in notes.metadata.personalization
//   alongside coverImagePath - moved out to config.entryTheme.

export type BackgroundType = 'pattern' | 'gradient' | 'image';

export interface BackgroundChoice {
  type: BackgroundType;
  // type 'pattern': PATTERN_PRESETS key, default 'blank' (flat color, no texture)
  pattern?: string;
  // type 'pattern': a COLOR_PRESETS key (e.g. 'sage') OR a raw hex string (e.g.
  // '#3a5f2b') from the custom color picker - resolveBackgroundStyle handles both.
  color?: string;
  // type 'gradient' | 'image': GRADIENT_PRESETS key, or an image file path/URL
  value?: string;
}

/** Global, account-synced (config.entryTheme) - background + font applied
 * uniformly to every entry, everywhere, on every device. */
export interface EntryTheme {
  background?: BackgroundChoice;
  fontFamily?: string; // a `fonts.name` value (e.g. 'Lora', 'Caveat'), or 'default'
}

/** Per-entry (notes.metadata.personalization) - just the cover photo now;
 * background/font moved to the global EntryTheme above. */
export interface EntryPersonalization {
  coverImagePath?: string;
  fontFamily?: string; // a `fonts.name` value (e.g. 'Lora', 'Caveat'), or 'default'
}

interface PatternDef {
  key: string;
  label: string;
  /** Tileable SVG data-URI, parameterized by texture fill color (hex, no #
   * needed to be stripped - callers pass e.g. '#8a6d4a') and its opacity.
   * 'blank' has no svg fn - it's flat color, no texture at all. */
  svg?: (fillHex: string, opacity: number) => string;
}

interface ThemedColorDef {
  key: string;
  label: string;
  light: string;
  dark: string;
}

interface ThemedGradientDef {
  key: string;
  label: string;
  light: [string, string];
  dark: [string, string];
}

const svgDataUri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

export const PATTERN_PRESETS: PatternDef[] = [
  { key: 'blank', label: 'Blank' },
  {
    key: 'grain',
    label: 'Paper grain',
    svg: (hex, opacity) => {
      const { r, g, b } = hexToRgb(hex);
      return svgDataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 ${opacity} 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`);
    },
  },
  {
    key: 'linen',
    label: 'Linen weave',
    svg: (hex, opacity) => svgDataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><path d='M0 0h16v1H0zM0 8h16v1H0z' fill='${hex}' fill-opacity='${opacity}'/><path d='M0 0v16h1V0zM8 0v16h1V0z' fill='${hex}' fill-opacity='${opacity}'/></svg>`),
  },
  {
    key: 'dots',
    label: 'Dot grid',
    svg: (hex, opacity) => svgDataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><circle cx='2' cy='2' r='1.1' fill='${hex}' fill-opacity='${opacity + 0.06}'/></svg>`),
  },
  {
    key: 'lines',
    label: 'Ruled lines',
    svg: (hex, opacity) => svgDataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='28'><line x1='0' y1='27' x2='40' y2='27' stroke='${hex}' stroke-opacity='${opacity + 0.04}' stroke-width='1'/></svg>`),
  },
];

// Warm accent colors - light variant is a soft pastel tint, dark variant is
// the same hue pulled toward the app's dark warm-paper palette
// (--secondbackground: #241a10-ish territory) instead of staying pastel-bright
// against dark UI chrome. A custom color (any hex, via the picker in
// BackgroundPicker) is stored/resolved independently of this list - see
// resolveColorChoice.
export const COLOR_PRESETS: ThemedColorDef[] = [
  { key: 'cream', label: 'Cream', light: '#f3e9d8', dark: '#2b2216' },
  { key: 'amber', label: 'Amber', light: '#f7e0c8', dark: '#332618' },
  { key: 'rose', label: 'Dusty rose', light: '#f0dede', dark: '#2e2222' },
  { key: 'sage', label: 'Sage', light: '#dde6d5', dark: '#212b1c' },
  { key: 'sky', label: 'Pale sky', light: '#dbe6ec', dark: '#1b262c' },
  { key: 'lavender', label: 'Lavender', light: '#e5ddf0', dark: '#251f30' },
];

export const GRADIENT_PRESETS: ThemedGradientDef[] = [
  { key: 'sunrise', label: 'Sunrise', light: ['#f7e0c8', '#e8b074'], dark: ['#332618', '#5a3d1f'] },
  { key: 'terracotta', label: 'Terracotta', light: ['#e0c9a6', '#b5541f'], dark: ['#2b2216', '#5c2b10'] },
  { key: 'meadow', label: 'Meadow', light: ['#eaf0e0', '#8fae7a'], dark: ['#1c2418', '#33472a'] },
  { key: 'dusk', label: 'Dusk', light: ['#ead9e8', '#8a6d9e'], dark: ['#241f2c', '#3d3350'] },
  { key: 'ocean', label: 'Ocean', light: ['#dbe6ec', '#5a8ba0'], dark: ['#16232c', '#274a5c'] },
];

export function getPatternPreset(key?: string) {
  return PATTERN_PRESETS.find(p => p.key === key);
}
export function getColorPreset(key?: string) {
  return COLOR_PRESETS.find(p => p.key === key);
}
export function getGradientPreset(key?: string) {
  return GRADIENT_PRESETS.find(p => p.key === key);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (isNaN(num) || full.length !== 6) return { r: 0.5, g: 0.5, b: 0.5 };
  return { r: ((num >> 16) & 255) / 255, g: ((num >> 8) & 255) / 255, b: (num & 255) / 255 };
}

/** Relative luminance (0 = black, 1 = white) - used to decide whether a
 * pattern's texture should be dark-on-this-color or light-on-this-color,
 * so it works for ANY chosen color (preset or fully custom), not just the
 * two app-theme states. */
function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Resolves a `color` value (either a COLOR_PRESETS key or a raw custom hex)
 * to an actual hex string for the given theme. Presets adapt to the app
 * theme; a custom hex is used as-is (the user's explicit choice overrides
 * the "auto-adapt to theme" convenience presets give you). */
export function resolveColorChoice(color: string | undefined, isDark: boolean): string {
  if (!color) return isDark ? COLOR_PRESETS[0]!.dark : COLOR_PRESETS[0]!.light;
  const preset = getColorPreset(color);
  if (preset) return isDark ? preset.dark : preset.light;
  return color; // raw custom hex
}

/** Moderate scrim so an uploaded image stays legible behind entry text,
 * without fully hiding the photo. Darker in dark mode (dark text-on-light
 * assumptions flip) - this is a deliberate compromise, not per-image contrast
 * analysis, since the user asked for image backgrounds despite the legibility
 * tradeoff flagged in the original research (docs/workstreams/09-*.md §3.1). */
function imageScrim(isDark: boolean): string {
  return isDark ? 'rgba(20, 16, 10, 0.55)' : 'rgba(255, 250, 240, 0.55)';
}

/** Resolves a background choice into actual CSS for the current theme. Used
 * for both per-entry (BlinkoCard, Editor) and page-wide (Layout) backgrounds -
 * same choice shape, same resolution logic either way. */
export function resolveBackgroundStyle(bg: BackgroundChoice | undefined, isDark: boolean): CSSProperties {
  if (!bg) return {};
  switch (bg.type) {
    case 'pattern': {
      const baseColor = resolveColorChoice(bg.color, isDark);
      const style: CSSProperties = { backgroundColor: baseColor };
      const pattern = getPatternPreset(bg.pattern);
      if (pattern?.svg) {
        // Dark texture on a light base color, light texture on a dark one -
        // derived from the actual chosen color, so this works whether the
        // color came from a theme-aware preset or a fully custom hex.
        const isLightBase = luminance(baseColor) > 0.5;
        const textureHex = isLightBase ? '#5c4a30' : '#e8b074';
        const opacity = isLightBase ? 0.08 : 0.1;
        style.backgroundImage = pattern.svg(textureHex, opacity);
        style.backgroundRepeat = 'repeat';
      }
      return style;
    }
    case 'gradient': {
      const preset = getGradientPreset(bg.value);
      if (!preset) return {};
      const [from, to] = isDark ? preset.dark : preset.light;
      return { backgroundImage: `linear-gradient(135deg, ${from}, ${to})` };
    }
    case 'image': {
      if (!bg.value) return {};
      // bg.value is a raw stored file path (e.g. /api/file/...), same shape as
      // coverImagePath - needs resolving to a full URL, same as EntryCoverImage.tsx.
      return {
        backgroundImage: `linear-gradient(${imageScrim(isDark)}, ${imageScrim(isDark)}), url("${getAuthenticatedImageUrl(bg.value)}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    default:
      return {};
  }
}

/** Convenience wrapper for the common "apply the global entry theme" case. */
export function getBackgroundStyle(entryTheme: EntryTheme | undefined, isDark: boolean): CSSProperties {
  return resolveBackgroundStyle(entryTheme?.background, isDark);
}

/** Deterministic (not random-per-render) gradient fallback for entries with
 * no cover image, reusing cardBlogBox.tsx's previously-unused gradientPairs
 * concept — hash the note id into a stable pair so entries get free visual
 * variety without any new asset work. */
export const COVER_GRADIENT_PAIRS: [string, string][] = [
  ['#e8b074', '#b5541f'], // warm amber/terracotta (matches the reskin's --primary)
  ['#d8c1a0', '#8a6d4a'],
  ['#e0c9a6', '#a97155'],
  ['#ead9c2', '#c98a5e'],
  ['#f0dede', '#c98686'],
  ['#dde6d5', '#7fa06b'],
];

export function gradientForNoteId(id?: number): [string, string] {
  if (!id) return COVER_GRADIENT_PAIRS[0]!;
  return COVER_GRADIENT_PAIRS[id % COVER_GRADIENT_PAIRS.length]!;
}

/** Sync — the font-family *value* itself needs async loading (FontManager),
 * but once a card has rendered once, the family is already resolvable from
 * the font's own name + a generic fallback; exact @font-face loading is
 * kicked off by whichever component renders the font picker (PersonalizeButton)
 * or the global FontSwitcher, both of which call FontManager already. */
export function getFontStyle(entryTheme?: EntryTheme): CSSProperties {
  const fontFamily = entryTheme?.fontFamily;
  if (!fontFamily || fontFamily === 'default') return {};
  return { fontFamily: `"${fontFamily}", var(--font-family)` };
}
