import type { CSSProperties } from 'react';
import { getBlinkoEndpoint } from './blinkoEndpoint';

// CUSTOM-JOURNAL: shared types/constants for personalization (background
// pattern/color/gradient/image, cover image, font), both per-entry
// (notes.metadata.personalization) and page-wide (a global config key, see
// PageBackgroundSetting.tsx). See docs/workstreams/09-entry-personalization.md
// for the original research; this file was revised after feedback that (a)
// presets need light/dark variants so a choice never looks wrong after a
// theme switch, and (b) backgrounds should support images and gradients too,
// not just flat colors/patterns, and should be choosable for the whole page,
// not just the entry card.

export type BackgroundType = 'pattern' | 'color' | 'gradient' | 'image';

export interface BackgroundChoice {
  type: BackgroundType;
  value: string; // preset key for pattern/color/gradient, or an image path/URL for 'image'
}

export interface EntryPersonalization {
  background?: BackgroundChoice;
  coverImagePath?: string;
  fontFamily?: string; // a `fonts.name` value (e.g. 'Lora', 'Caveat'), or 'default'
}

interface ThemedPatternDef {
  key: string;
  label: string;
  // Tileable SVG data-URIs, one per theme, so the same "grain"/"dots"/etc.
  // choice keeps looking like subtle paper texture instead of a mismatched
  // light pattern floating on a dark background (or vice versa).
  light: string;
  dark: string;
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

const grain = (fillOpacityRgb: string, alpha: string) =>
  svgDataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 ${fillOpacityRgb}  0 0 0 ${alpha} 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`);

export const PATTERN_PRESETS: ThemedPatternDef[] = [
  { key: 'blank', label: 'Blank', light: 'none', dark: 'none' },
  {
    key: 'grain',
    label: 'Paper grain',
    light: grain('0.55  0 0 0 0 0.42  0 0 0 0 0.30', '0.05'),
    dark: grain('0.85  0 0 0 0 0.72  0 0 0 0 0.55', '0.06'),
  },
  {
    key: 'linen',
    label: 'Linen weave',
    light: svgDataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><path d='M0 0h16v1H0zM0 8h16v1H0z' fill='#8a6d4a' fill-opacity='0.05'/><path d='M0 0v16h1V0zM8 0v16h1V0z' fill='#8a6d4a' fill-opacity='0.05'/></svg>`),
    dark: svgDataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><path d='M0 0h16v1H0zM0 8h16v1H0z' fill='#e8b074' fill-opacity='0.07'/><path d='M0 0v16h1V0zM8 0v16h1V0z' fill='#e8b074' fill-opacity='0.07'/></svg>`),
  },
  {
    key: 'dots',
    label: 'Dot grid',
    light: svgDataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><circle cx='2' cy='2' r='1.1' fill='#8a6d4a' fill-opacity='0.14'/></svg>`),
    dark: svgDataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><circle cx='2' cy='2' r='1.1' fill='#e8b074' fill-opacity='0.16'/></svg>`),
  },
  {
    key: 'lines',
    label: 'Ruled lines',
    light: svgDataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='28'><line x1='0' y1='27' x2='40' y2='27' stroke='#8a6d4a' stroke-opacity='0.12' stroke-width='1'/></svg>`),
    dark: svgDataUri(`<svg xmlns='http://www.w3.org/2000/svg' width='40' height='28'><line x1='0' y1='27' x2='40' y2='27' stroke='#e8b074' stroke-opacity='0.14' stroke-width='1'/></svg>`),
  },
];

// Warm accent colors - light variant is a soft pastel tint, dark variant is
// the same hue pulled toward the app's dark warm-paper palette
// (--secondbackground: #241a10-ish territory) instead of staying pastel-bright
// against dark UI chrome.
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

/** Moderate scrim so an uploaded image stays legible behind entry text,
 * without fully hiding the photo. Darker in dark mode (dark text-on-light
 * assumptions flip) - this is a deliberate compromise, not per-image contrast
 * analysis, since the user asked for image backgrounds despite the legibility
 * tradeoff flagged in the original research (docs/workstreams/09-*.md §3.1). */
function imageScrim(isDark: boolean): string {
  return isDark ? 'rgba(20, 16, 10, 0.55)' : 'rgba(255, 250, 240, 0.55)';
}

/** Resolves a background choice (pattern/color/gradient/image key or path)
 * into actual CSS for the current theme. Used for both per-entry (BlinkoCard,
 * Editor) and page-wide (Layout) backgrounds - same choice shape, same
 * resolution logic either way. */
export function resolveBackgroundStyle(bg: BackgroundChoice | undefined, isDark: boolean): CSSProperties {
  if (!bg) return {};
  switch (bg.type) {
    case 'color': {
      const preset = getColorPreset(bg.value);
      if (!preset) return {};
      return { backgroundColor: isDark ? preset.dark : preset.light };
    }
    case 'gradient': {
      const preset = getGradientPreset(bg.value);
      if (!preset) return {};
      const [from, to] = isDark ? preset.dark : preset.light;
      return { backgroundImage: `linear-gradient(135deg, ${from}, ${to})` };
    }
    case 'pattern': {
      const preset = getPatternPreset(bg.value);
      if (!preset) return {};
      const image = isDark ? preset.dark : preset.light;
      if (image === 'none') return {};
      return { backgroundImage: image, backgroundRepeat: 'repeat' };
    }
    case 'image': {
      if (!bg.value) return {};
      // bg.value is a raw stored file path (e.g. /api/file/...), same shape as
      // coverImagePath - needs resolving to a full URL, same as EntryCoverImage.tsx.
      return {
        backgroundImage: `linear-gradient(${imageScrim(isDark)}, ${imageScrim(isDark)}), url("${getBlinkoEndpoint(bg.value)}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    default:
      return {};
  }
}

/** Convenience wrapper for the common per-entry case. */
export function getBackgroundStyle(personalization: EntryPersonalization | undefined, isDark: boolean): CSSProperties {
  return resolveBackgroundStyle(personalization?.background, isDark);
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
export function getFontStyle(personalization?: EntryPersonalization): CSSProperties {
  const fontFamily = personalization?.fontFamily;
  if (!fontFamily || fontFamily === 'default') return {};
  return { fontFamily: `"${fontFamily}", var(--font-family)` };
}
