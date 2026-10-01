import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import type { MessageSource } from '../model';

/**
 * Answers as sanitised Markdown (spec 5.2 item 4, 6 "Privacy") with
 * clickable citations (D13). Model output is untrusted: `marked` renders it,
 * DOMPurify keeps only the tags Markdown produces, and nothing loads by
 * itself (no images, media or frames), so an answer can't carry page data
 * to another server.
 *
 * Model output can't produce anything that looks or reads like a citation:
 * the sanitiser drops `class`, `data-*`, `aria-*`, `role` and buttons, and
 * the genuine citations are created afterwards, from the stored source list
 * only. A citation is a `<button class="citation">` carrying just its
 * number: it has no address, so no click (middle, Ctrl) can bypass the
 * sidebar, which looks the number up in the stored sources and focuses the
 * tab or opens the URL. Links from the model are ordinary external links:
 * marked as such (`external-link`), with the real address as tooltip, opened
 * in a new tab without opener or referrer.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const marked = new Marked({
  async: false,
  gfm: true,
  breaks: false,
  renderer: {
    // An image would load from a URL the model chose; show its alt text instead.
    image({ text }) {
      return escapeHtml(text);
    },
  },
});

const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'del',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];

const ALLOWED_ATTR = ['href', 'title', 'start', 'align'];

const SAFE_HREF = /^(https?:|mailto:)/i;

/** Accessible name of a citation link, e.g. "Source 1: <title>". */
export type CitationLabel = (index: number, title: string) => string;

const CITATION = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

/** Parts of the group text: numbers and the separators between them. */
function splitGroup(group: string): string[] {
  return group.split(/(\d+)/).filter((part) => part !== '');
}

/** Class of the genuine citation buttons; model output can't carry classes. */
export const CITATION_CLASS = 'citation';
/** Class put on every link that came from the model. */
export const EXTERNAL_LINK_CLASS = 'external-link';

function citationButton(doc: Document, source: MessageSource, label: CitationLabel, text: string) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = CITATION_CLASS;
  button.dataset.citation = String(source.index);
  button.title = source.title;
  button.setAttribute('aria-label', label(source.index, source.title));
  button.textContent = text;
  return button;
}

/** Replaces `[n]` in one text node with citation buttons; numbers without a source stay text. */
function linkCitations(
  node: Text,
  sources: ReadonlyMap<number, MessageSource>,
  label: CitationLabel,
): void {
  const text = node.data;
  CITATION.lastIndex = 0;
  if (!CITATION.test(text)) return;
  CITATION.lastIndex = 0;
  const doc = node.ownerDocument;
  const out: (Node | string)[] = [];
  let last = 0;
  let changed = false;
  for (const match of text.matchAll(CITATION)) {
    const group = match[1] ?? '';
    const numbers = group.split(',').map((n) => Number(n.trim()));
    if (!numbers.some((n) => sources.has(n))) continue;
    changed = true;
    out.push(text.slice(last, match.index));
    const single = numbers.length === 1 ? sources.get(numbers[0] ?? -1) : undefined;
    if (single) {
      out.push(citationButton(doc, single, label, match[0]));
    } else {
      out.push('[');
      for (const part of splitGroup(group)) {
        const source = /^\d+$/.test(part) ? sources.get(Number(part)) : undefined;
        out.push(source ? citationButton(doc, source, label, part) : part);
      }
      out.push(']');
    }
    last = match.index + match[0].length;
  }
  if (!changed) return;
  out.push(text.slice(last));
  node.replaceWith(...out.filter((part) => part !== ''));
}

function textNodes(root: Node): Text[] {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent?.closest('a, code, pre')) nodes.push(n as Text);
  }
  return nodes;
}

/**
 * Renders an answer to a sanitised DOM fragment. `sources` are the pages the
 * request carried; `[n]` becomes a citation button for source `n` when it
 * exists and is a web page.
 */
export function renderAnswer(
  text: string,
  sources: readonly MessageSource[],
  label: CitationLabel,
): DocumentFragment {
  const html = marked.parse(text) as string;
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_HREF,
    // Without these two, DOMPurify lets every `data-*` and `aria-*` through.
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const a of fragment.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    if (href && SAFE_HREF.test(href)) {
      a.className = EXTERNAL_LINK_CLASS;
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      // The tooltip is the real address, whatever title the model gave.
      a.setAttribute('title', href);
    } else {
      a.removeAttribute('href');
      a.removeAttribute('title');
    }
  }
  const byIndex = new Map(
    sources.filter((s) => /^https?:/i.test(s.url)).map((s) => [s.index, s] as const),
  );
  if (byIndex.size > 0) {
    for (const node of textNodes(fragment)) linkCitations(node, byIndex, label);
  }
  return fragment;
}
