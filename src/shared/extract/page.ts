import { Readability, isProbablyReaderable } from '@mozilla/readability';

/**
 * Generic page extraction (spec 5.5, kind "Page"). Runs inside the page via
 * `scripting.executeScript` (`src/entrypoints/extract-page.ts`) and is a pure
 * function of the document, so it is unit-tested on HTML fixtures. The text
 * goes back to the caller only; nothing here logs or sends it.
 */

/** Extracted text is capped per pin (spec 5.5). */
export const MAX_TEXT_CHARS = 200_000;

export interface PageText {
  title: string;
  text: string;
  /** True when the text was cut at `MAX_TEXT_CHARS`. */
  truncated: boolean;
  /** Readability's article, or the `innerText` fallback. */
  method: 'readability' | 'innerText';
}

/** Cuts `text` at `max` characters without splitting a surrogate pair. */
export function capText(
  text: string,
  max: number = MAX_TEXT_CHARS,
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}

const BLOCKS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'CAPTION',
  'DD',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'SECTION',
  'SUMMARY',
  'TABLE',
  'TBODY',
  'THEAD',
  'TFOOT',
  'TR',
  'UL',
]);

const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME']);

/** Collapses spaces within each line, trims lines and drops blank ones. */
function tidyLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Plain text of an article element: one paragraph per block element,
 * separated by a blank line; `<br>` is a line break, list items start with
 * "- ", `<pre>` keeps its whitespace.
 */
export function blockText(root: Element): string {
  const blocks: string[] = [];
  let line = '';
  const flush = () => {
    const tidy = tidyLines(line);
    if (tidy !== '') blocks.push(tidy);
    line = '';
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      line += (node.nodeValue ?? '').replace(/\s+/g, ' ');
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName.toUpperCase();
    if (SKIPPED.has(tag)) return;
    if (tag === 'BR') {
      line += '\n';
      return;
    }
    if (tag === 'PRE') {
      flush();
      const pre = (node.textContent ?? '').replace(/^\n+|\s+$/g, '');
      if (pre.trim() !== '') blocks.push(pre);
      return;
    }
    if (tag === 'TD' || tag === 'TH') line += ' ';
    const block = BLOCKS.has(tag);
    if (block) flush();
    if (tag === 'LI') line += '- ';
    for (const child of Array.from(node.childNodes)) walk(child);
    if (block) flush();
  };
  walk(root);
  flush();
  return blocks.join('\n\n');
}

/** `innerText` of the body, tidied: no runs of spaces, at most one blank line. */
function fallbackText(doc: Document): string {
  const body = doc.body as HTMLElement | null;
  const raw = body ? body.innerText || body.textContent || '' : '';
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readable(doc: Document): { title: string; text: string } | null {
  if (!isProbablyReaderable(doc)) return null;
  // Readability changes the document it parses, so it gets a clone. The
  // serializer hands back the article element, so no HTML is re-parsed.
  const clone = doc.cloneNode(true) as Document;
  const article = new Readability<Node | null>(clone, { serializer: (node) => node }).parse();
  const content = article?.content;
  if (!content || content.nodeType !== 1) return null;
  const text = blockText(content as Element);
  if (text === '') return null;
  return { title: (article.title ?? '').trim(), text };
}

/**
 * The readable text of `doc`: Readability's article when the page looks
 * like one, else the body's `innerText`; capped at `MAX_TEXT_CHARS`.
 */
export function extractFromDocument(doc: Document): PageText {
  const title = doc.title.trim();
  const article = readable(doc);
  if (article) {
    const capped = capText(article.text);
    return { title: article.title || title, ...capped, method: 'readability' };
  }
  return { title, ...capText(fallbackText(doc)), method: 'innerText' };
}
