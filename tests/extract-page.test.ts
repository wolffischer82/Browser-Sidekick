import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_TEXT_CHARS, capText, extractFromDocument } from '@/shared/extract/page';

const MARKERS = [
  'SCRIPT-SHOULD-NOT-APPEAR',
  'NAVIGATION-SHOULD-NOT-APPEAR',
  'ADVERT-SHOULD-NOT-APPEAR',
  'FOOTER-SHOULD-NOT-APPEAR',
];

function fixture(name: string): Document {
  const file = resolve(__dirname, 'fixtures/pages', name);
  return new DOMParser().parseFromString(readFileSync(file, 'utf8'), 'text/html');
}

function html(body: string, title = 'Test page'): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`,
    'text/html',
  );
}

describe('extractFromDocument: article', () => {
  const doc = fixture('article.html');
  const before = doc.documentElement.outerHTML;
  const result = extractFromDocument(doc);

  it('uses Readability and the article title', () => {
    expect(result.method).toBe('readability');
    expect(result.title).toBe('Night trains return to Europe');
    expect(result.truncated).toBe(false);
  });

  it('keeps the article text as clean paragraphs', () => {
    expect(result.text).toContain(
      'After years of decline, overnight rail services are coming back across Europe. Operators are ordering new sleeper cars,',
    );
    expect(result.text).toContain('because several operators now share the same carriages.');
    expect(result.text).toContain('What changed\n\nTimetables were redesigned');
    expect(result.text).toContain(
      '- Vienna to Amsterdam, three times a week\n\n- Berlin to Brussels',
    );
    expect(result.text).toContain('different and growing.\nTicket sales rose again last year.');
    expect(result.text).toContain('  Departure 21:04\n  Arrival   08:47');
    // Outside <pre>, runs of spaces are collapsed.
    const prose = result.text.slice(0, result.text.indexOf('  Departure'));
    expect(prose).not.toMatch(/ {2,}/);
    expect(result.text).not.toMatch(/\n{3,}/);
    expect(result.text).toBe(result.text.trim());
  });

  it('drops navigation, adverts, footer and scripts', () => {
    for (const marker of MARKERS) expect(result.text).not.toContain(marker);
  });

  it('works on a clone and leaves the page untouched', () => {
    expect(doc.documentElement.outerHTML).toBe(before);
  });
});

describe('extractFromDocument: non-article', () => {
  const result = extractFromDocument(fixture('non-article.html'));

  it('falls back to the page text', () => {
    expect(result.method).toBe('innerText');
    expect(result.title).toBe('Fixture dashboard');
    for (const text of ['Inbox', 'Open tickets', '12', 'Average reply', 'Printer offline', 'Low']) {
      expect(result.text).toContain(text);
    }
    expect(result.text).not.toContain('SCRIPT-SHOULD-NOT-APPEAR');
    expect(result.text).not.toMatch(/\n{3,}/);
    expect(result.text).toBe(result.text.trim());
  });

  it('returns empty text for an empty page', () => {
    const empty = extractFromDocument(html('   '));
    expect(empty).toEqual({ title: 'Test page', text: '', truncated: false, method: 'innerText' });
  });

  it('uses the URL-less fallback title when the page has none', () => {
    expect(extractFromDocument(html('<p>Hello</p>', '')).title).toBe('');
  });
});

describe('extractFromDocument: huge pages', () => {
  const paragraph = (i: number) =>
    `<p>Paragraph ${String(i)}. Sleeper trains, timetables, carriages and the night market, described at length.</p>`;

  it('caps an article at 200,000 characters and marks it truncated', () => {
    const body = `<article><h1>Long read</h1>${Array.from({ length: 3000 }, (_, i) => paragraph(i)).join('')}</article>`;
    const result = extractFromDocument(html(body, 'Long read'));
    expect(result.method).toBe('readability');
    expect(result.text).toHaveLength(MAX_TEXT_CHARS);
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith('Paragraph 0.')).toBe(true);
  });

  it('caps the fallback text too', () => {
    const body = `<div>${'word '.repeat(60_000)}</div>`;
    const result = extractFromDocument(html(body));
    expect(result.method).toBe('innerText');
    expect(result.text).toHaveLength(MAX_TEXT_CHARS);
    expect(result.truncated).toBe(true);
  });
});

describe('capText', () => {
  it('leaves short text alone', () => {
    expect(capText('abc', 5)).toEqual({ text: 'abc', truncated: false });
    expect(capText('abcde', 5)).toEqual({ text: 'abcde', truncated: false });
  });

  it('cuts long text at the cap', () => {
    expect(capText('abcdef', 5)).toEqual({ text: 'abcde', truncated: true });
  });

  it('never splits a surrogate pair', () => {
    expect(capText('abcd😀x', 5)).toEqual({ text: 'abcd', truncated: true });
  });

  it('defaults to the spec cap', () => {
    expect(MAX_TEXT_CHARS).toBe(200_000);
  });
});
