import type { CSSProperties } from 'react';

// CUSTOM-JOURNAL: shared types/constants for per-entry personalization
// (background pattern/color, cover image, font). Stored under
// `notes.metadata.personalization` — see docs/workstreams/09-entry-personalization.md
// for the research behind this feature set. The metadata field already
// round-trips editor -> API -> DB -> card (shallow-merged additively server
// side), so this is additive-only: a new namespaced key, not new plumbing.

export interface EntryPersonalization {
  background?: {
    type: 'pattern' | 'color';
    value: string; // pattern key (see PATTERNS) or a hex color
  };
  coverImagePath?: string;
  fontFamily?: string; // a `fonts.name` value (e.g. 'Lora', 'Caveat'), or 'default'
}

export interface PatternDef {
  key: string;
  label: string;
  // A tileable background-image value (SVG data-URI) — kept subtle/monochrome
  // so it reads as "paper texture" against the warm palette in both themes,
  // not as a loud decorative pattern.
  backgroundImage: string;
}

const svgDataUri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

export const PATTERNS: PatternDef[] = [
  { key: 'blank', label: 'Blank', backgroundImage: 'none' },
  {
    key: 'grain',
    label: 'Paper grain',
    backgroundImage: svgDataUri(
      `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 0.55  0 0 0 0 0.42  0 0 0 0 0.30  0 0 0 0.05 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`
    ),
  },
  {
    key: 'linen',
    label: 'Linen weave',
    backgroundImage: svgDataUri(
      `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><path d='M0 0h16v1H0zM0 8h16v1H0z' fill='#8a6d4a' fill-opacity='0.05'/><path d='M0 0v16h1V0zM8 0v16h1V0z' fill='#8a6d4a' fill-opacity='0.05'/></svg>`
    ),
  },
  {
    key: 'dots',
    label: 'Dot grid',
    backgroundImage: svgDataUri(
      `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><circle cx='2' cy='2' r='1.1' fill='#8a6d4a' fill-opacity='0.14'/></svg>`
    ),
  },
  {
    key: 'lines',
    label: 'Ruled lines',
    backgroundImage: svgDataUri(
      `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='28'><line x1='0' y1='27' x2='40' y2='27' stroke='#8a6d4a' stroke-opacity='0.12' stroke-width='1'/></svg>`
    ),
  },
];

// Warm accent colors for the "color" background type — a smaller, warmer
// palette than ThemeColor.tsx's global theme-color picker (this is a subtle
// tint behind the card, not the app's primary accent color).
export const ACCENT_COLORS: string[] = [
  '#f3e9d8', // warm cream (matches --secondbackground)
  '#f7e0c8', // soft amber
  '#f0dede', // dusty rose
  '#dde6d5', // sage
  '#dbe6ec', // pale sky
  '#e5ddf0', // soft lavender
];

export function getPatternByKey(key?: string): PatternDef | undefined {
  return PATTERNS.find(p => p.key === key);
}

/** Sync — pure function of the pattern/color list, no font loading involved. */
export function getBackgroundStyle(personalization?: EntryPersonalization): CSSProperties {
  const bg = personalization?.background;
  if (!bg) return {};
  if (bg.type === 'color') {
    return { backgroundColor: bg.value };
  }
  const pattern = getPatternByKey(bg.value);
  if (!pattern || pattern.backgroundImage === 'none') return {};
  return { backgroundImage: pattern.backgroundImage, backgroundRepeat: 'repeat' };
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
