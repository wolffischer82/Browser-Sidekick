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

describe('store permission justifications', () => {
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, '..', path), 'utf8');
  interface Manifest {
    permissions?: string[];
    host_permissions?: string[];
    optional_host_permissions?: string[];
    browser_specific_settings?: { gecko?: { data_collection_permissions?: unknown } };
  }
  const manifest = (browser: string) =>
    JSON.parse(read(`dist/${browser}-ext/manifest.json`)) as Manifest;
  const hostOf = (pattern: string) =>
    pattern === '<all_urls>' ? pattern : new URL(pattern.replace('*', 'x')).hostname;

  it('chrome-web-store.md justifies every permission of the Chrome manifest', () => {
    const doc = read('docs/store/chrome-web-store.md');
    const chrome = manifest('chrome');
    for (const permission of chrome.permissions ?? []) {
      expect(doc, permission).toContain(`### ${permission}\n`);
    }
    const hosts = doc.slice(doc.indexOf('### Host permissions'), doc.indexOf('## Remote code'));
    for (const pattern of [
      ...(chrome.host_permissions ?? []),
      ...(chrome.optional_host_permissions ?? []),
    ]) {
      expect(hosts, pattern).toContain(hostOf(pattern));
    }
  });

  it('amo.md explains every permission of the Firefox manifest', () => {
    const doc = read('docs/store/amo.md');
    const firefox = manifest('firefox');
    const section = doc.slice(doc.indexOf('## Permissions'));
    for (const permission of [
      ...(firefox.permissions ?? []),
      ...(firefox.host_permissions ?? []),
      ...(firefox.optional_host_permissions ?? []),
    ]) {
      expect(section, permission).toContain(`\`${permission}\``);
    }
  });

  it('amo.md quotes the Firefox data_collection_permissions as declared', () => {
    const doc = read('docs/store/amo.md');
    const block = /## Data collection permissions[\s\S]*?```json\n([\s\S]*?)\n```/.exec(doc);
    expect(JSON.parse(block?.[1] ?? 'null')).toEqual(
      manifest('firefox').browser_specific_settings?.gecko?.data_collection_permissions,
    );
  });
});
