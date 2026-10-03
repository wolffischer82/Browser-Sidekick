import { describe, expect, it } from 'vitest';
import { parseStyle, SPEC_TOKENS } from './helpers/style';

// Redesign spec 4.1: colours are defined once, as tokens, light by default and
// dark under `prefers-color-scheme: dark`; no colour literal anywhere else.

const style = parseStyle();

/** The innermost `{ ... }` bodies, i.e. the declaration lists, of a sheet. */
function declarationBodies(css: string): string[] {
  return [...css.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] ?? '');
}

const NAMED_COLOURS =
  /(^|[\s,(:])(white|black|red|green|blue|yellow|orange|purple|gray|grey|silver|maroon|navy|teal|olive|lime|aqua|fuchsia|pink|brown)(?=$|[\s,);])/i;

describe('style.css colour tokens', () => {
  it('defines every spec token in the light and the dark block with the spec value', () => {
    for (const [name, value] of Object.entries(SPEC_TOKENS)) {
      expect(style.light.get(name)?.toLowerCase(), `${name} (light)`).toBe(
        value.light.toLowerCase(),
      );
      expect(style.dark.get(name)?.toLowerCase(), `${name} (dark)`).toBe(value.dark.toLowerCase());
    }
  });

  it('defines the same token names in both blocks', () => {
    expect([...style.dark.keys()].sort()).toEqual([...style.light.keys()].sort());
  });

  it('has no colour literal outside the token blocks', () => {
    for (const body of declarationBodies(style.rest)) {
      for (const decl of body.split(';')) {
        const value = decl.slice(decl.indexOf(':') + 1);
        if (decl.indexOf(':') < 0) continue;
        expect(value, decl.trim()).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(value, decl.trim()).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
        expect(value, decl.trim()).not.toMatch(NAMED_COLOURS);
      }
    }
  });

  it('uses only tokens that are defined (old names are gone, not aliased)', () => {
    // Non-colour custom properties (the font stacks) live outside the token blocks.
    const defined = new Set([
      ...style.light.keys(),
      ...[...style.rest.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
    ]);
    const used = new Set([...style.rest.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    for (const name of used) {
      expect(defined.has(name), `${name ?? ''} is not defined`).toBe(true);
    }
    for (const old of [
      '--bg-raised',
      '--bg-hover',
      '--fg',
      '--fg-muted',
      '--border',
      '--focus',
      '--accent-fg',
      '--danger-fg',
      '--warning-bg',
      '--warning-fg',
    ]) {
      expect(style.light.has(old), old).toBe(false);
    }
  });

  it('the parser finds literals outside the token blocks', () => {
    const bad = parseStyle(
      ':root { --bg: #fff; }\n@media (prefers-color-scheme: dark) { :root { --bg: #000; } }\n.a { color: #123456; }',
    );
    expect(bad.rest).toContain('#123456');
    expect(bad.rest).not.toContain('#fff');
    expect(bad.rest).not.toContain('#000');
  });
});
