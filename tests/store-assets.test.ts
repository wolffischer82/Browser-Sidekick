import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSETS_DIR, pngSize, sizeProblems } from './store/png';

// Store T24: the committed store images (docs/store/assets, written by
// `npm run store:assets`) have exactly the sizes the stores require.

describe('store assets', () => {
  const names = readdirSync(ASSETS_DIR).sort();

  it('has at least three screenshots and a promo tile per language', () => {
    for (const lang of ['en', 'de']) {
      const shots = names.filter((n) => n.startsWith('screenshot-') && n.endsWith(`.${lang}.png`));
      expect(shots.length, lang).toBeGreaterThanOrEqual(3);
      expect(names, lang).toContain(`promo-small.${lang}.png`);
    }
  });

  it('has the same screenshots in English and German', () => {
    const topics = (lang: string) =>
      names.filter((n) => n.endsWith(`.${lang}.png`)).map((n) => n.replace(`.${lang}.png`, ''));
    expect(topics('de')).toEqual(topics('en'));
  });

  it('screenshots are 1280×800 and promo tiles 440×280', () => {
    expect(sizeProblems()).toEqual([]);
  });

  it('reads the size from the PNG header and rejects other files', () => {
    const header = Buffer.from('89504e470d0a1a0a0000000d49484452000005000000032008060000', 'hex');
    expect(pngSize(header)).toEqual({ width: 1280, height: 800 });
    expect(() => pngSize(Buffer.from('GIF89a, not a PNG at all, really'))).toThrow();
  });
});
