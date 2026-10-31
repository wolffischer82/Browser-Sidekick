import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listingField } from './store/listing';

// Store T24: the listing texts in docs/store fit the stores' limits, and the
// Chrome short description is the manifest description the store shows.

const LANGS = ['en', 'de'] as const;

/** Length in code points. */
const chars = (text: string) => Array.from(text).length;

function extDescription(lang: string): string {
  const file = resolve(import.meta.dirname, `../public/_locales/${lang}/messages.json`);
  const messages = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { message: string }>;
  return messages.extDescription?.message ?? '';
}

describe.each(LANGS)('store listing (%s)', (lang) => {
  it('Chrome short description: at most 132 characters, equal to the manifest description', () => {
    const text = listingField(lang, 'Chrome short description');
    expect(chars(text)).toBeLessThanOrEqual(132);
    expect(text).toBe(extDescription(lang));
  });

  it('AMO summary: at most 250 characters, one line', () => {
    const text = listingField(lang, 'AMO summary');
    expect(chars(text)).toBeLessThanOrEqual(250);
    expect(text).not.toContain('\n');
  });

  it('full description: plain text within the Chrome limit of 16,000 characters', () => {
    const text = listingField(lang, 'Full description');
    expect(chars(text)).toBeLessThanOrEqual(16_000);
    // No Markdown the stores would show literally: emphasis, headings, links, code.
    expect(text).not.toMatch(/\*\*|__|^#|\]\(|`/m);
    // The only email address is the contact address (O1).
    expect(text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g)).toEqual(['feedback@findach.de']);
  });

  it('name is the extension name', () => {
    expect(listingField(lang, 'Name')).toBe('Browser Sidekick');
  });
});
