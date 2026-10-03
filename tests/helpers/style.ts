import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The side panel's stylesheet, as shipped. */
export const STYLE_PATH = resolve(import.meta.dirname, '../../src/entrypoints/sidepanel/style.css');

/** Redesign spec 4.1: every colour token and its light and dark value. */
export const SPEC_TOKENS: Record<string, { light: string; dark: string }> = {
  '--bg': { light: '#F6F6F3', dark: '#111214' },
  '--surface': { light: '#FFFFFF', dark: '#1A1B1E' },
  '--sunken': { light: '#EFEFEB', dark: '#24252A' },
  '--line': { light: '#E4E4DF', dark: '#2D2F35' },
  '--ink': { light: '#17181B', dark: '#ECEDEF' },
  '--muted': { light: '#5D616A', dark: '#A2A6AE' },
  '--accent': { light: '#2D5BE3', dark: '#8EA8EE' },
  '--accent-soft': { light: '#EEF2FC', dark: '#2D323F' },
  '--on-accent': { light: '#FFFFFF', dark: '#0E1013' },
  '--ok': { light: '#1E7A46', dark: '#6FCF97' },
  '--warning': { light: '#7A5300', dark: '#F1C96B' },
  '--warning-soft': { light: '#FBF0D9', dark: '#3A2F14' },
  '--danger': { light: '#B42318', dark: '#F97066' },
  '--shadow': {
    light: '0 1px 2px rgb(20 20 25 / 5%), 0 6px 20px rgb(20 20 25 / 6%)',
    dark: '0 1px 2px rgb(0 0 0 / 40%), 0 6px 20px rgb(0 0 0 / 30%)',
  },
};

export interface ParsedStyle {
  /** Declarations of the light token block (the first top-level `:root`). */
  light: Map<string, string>;
  /** Declarations of the `:root` inside `@media (prefers-color-scheme: dark)`. */
  dark: Map<string, string>;
  /** The sheet without comments and without both token blocks. */
  rest: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The body of the block whose opening brace is at `open`, and the index after its `}`. */
function block(css: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return { body: css.slice(open + 1, i), end: i + 1 };
    }
  }
  throw new Error('Unbalanced braces in style.css');
}

function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const decl of body.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const name = decl.slice(0, colon).trim();
    if (name.startsWith('--'))
      map.set(
        name,
        decl
          .slice(colon + 1)
          .trim()
          .replace(/\s+/g, ' '),
      );
  }
  return map;
}

export function parseStyle(css = readFileSync(STYLE_PATH, 'utf8')): ParsedStyle {
  const text = stripComments(css);

  const lightStart = text.search(/(^|\n):root\s*\{/);
  if (lightStart < 0) throw new Error('No light token block');
  const lightOpen = text.indexOf('{', lightStart);
  const light = block(text, lightOpen);

  const mediaStart = text.search(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/);
  if (mediaStart < 0) throw new Error('No dark token block');
  const media = block(text, text.indexOf('{', mediaStart));
  const rootInMedia = media.body.search(/:root\s*\{/);
  if (rootInMedia < 0) throw new Error('No :root in the dark media block');
  const dark = block(media.body, media.body.indexOf('{', rootInMedia));
  if (media.body.slice(dark.end).trim() !== '') {
    throw new Error('The dark media block holds more than the token block');
  }

  const rest =
    text.slice(0, lightStart) + text.slice(light.end, mediaStart) + text.slice(media.end);

  return { light: declarations(light.body), dark: declarations(dark.body), rest };
}

/** `#rgb` or `#rrggbb` to [r, g, b] in 0..255. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, '$&$&') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2 relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG 2 contrast ratio of two hex colours. */
export function contrast(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
