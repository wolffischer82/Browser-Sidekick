import { describe, expect, it } from 'vitest';
import { contrast, parseStyle } from './helpers/style';

// Redesign spec 4.1: text on its background meets 4.5:1 in both themes. The
// pairs are the ones the side panel draws: text tokens on the grounds they sit
// on, and the text tokens of the filled controls and notices.

const style = parseStyle();

const PAIRS: [text: string, background: string][] = [
  ...['--ink', '--muted', '--accent', '--ok', '--warning', '--danger'].flatMap((text) =>
    ['--bg', '--surface', '--sunken'].map((bg): [string, string] => [text, bg]),
  ),
  ['--ink', '--accent-soft'],
  ['--muted', '--accent-soft'],
  ['--accent', '--accent-soft'],
  ['--danger', '--accent-soft'],
  ['--ink', '--warning-soft'],
  ['--warning', '--warning-soft'],
  ['--on-accent', '--accent'],
  ['--on-accent', '--danger'],
];

describe.each(['light', 'dark'] as const)('contrast in the %s theme', (theme) => {
  const tokens = style[theme];

  it.each(PAIRS)('%s on %s is at least 4.5:1', (text, background) => {
    const fg = tokens.get(text);
    const bg = tokens.get(background);
    expect(fg, text).toBeDefined();
    expect(bg, background).toBeDefined();
    expect(contrast(fg ?? '', bg ?? '')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('contrast()', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});
