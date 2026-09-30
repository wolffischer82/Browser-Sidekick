import { browser } from 'wxt/browser';
import type { PinKind } from '../model';
import { CURRENT_BROWSER, isRestrictedUrl, type BrowserName } from '../restricted';
import { isAccessError } from './access';
import type { PageText } from './page';
import { youtubeExtractor } from './youtube-extractor';

/**
 * Extractor dispatcher (spec 5.5). Picks the extractor for a tab's URL and
 * runs it. Each extractor returns the text to the caller only: nothing is
 * logged or sent anywhere from here.
 */

/**
 * Why an extraction failed; stored as `Pin.failureReason` (decisions.md T02-2)
 * and localised by `extractionFailureMessage`.
 */
export type ExtractionFailure = 'restricted' | 'no-access' | 'empty' | 'unreadable';

export type ExtractionResult =
  | {
      ok: true;
      kind: PinKind;
      title: string;
      text: string;
      charCount: number;
      truncated: boolean;
    }
  | { ok: false; kind: PinKind; reason: ExtractionFailure };

/** One extractor per kind; the first whose `matches` accepts the URL runs. */
export interface Extractor {
  kind: PinKind;
  matches(url: URL): boolean;
  extract(tabId: number, url: string): Promise<ExtractionResult>;
}

/** The injected generic extractor, built from `src/entrypoints/extract-page.ts`. */
export const PAGE_SCRIPT = '/extract-page.js';

function isPageText(value: unknown): value is PageText {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === 'string' &&
    typeof v.text === 'string' &&
    typeof v.truncated === 'boolean' &&
    (v.method === 'readability' || v.method === 'innerText')
  );
}

/** Generic pages: Readability with the `innerText` fallback (spec 5.5, kind "Page"). */
export const pageExtractor: Extractor = {
  kind: 'page',
  matches: () => true,
  async extract(tabId) {
    let results: { result?: unknown }[];
    try {
      results = await browser.scripting.executeScript({
        target: { tabId },
        files: [PAGE_SCRIPT],
      });
    } catch (error) {
      return { ok: false, kind: 'page', reason: isAccessError(error) ? 'no-access' : 'unreadable' };
    }
    const page = results[0]?.result;
    if (!isPageText(page)) return { ok: false, kind: 'page', reason: 'unreadable' };
    if (page.text === '') return { ok: false, kind: 'page', reason: 'empty' };
    return {
      ok: true,
      kind: 'page',
      title: page.title,
      text: page.text,
      charCount: page.text.length,
      truncated: page.truncated,
    };
  },
};

/**
 * Registered extractors, most specific first: YouTube (T08) before the
 * generic page extractor, which matches everything. T09 adds PDF.
 */
export const EXTRACTORS: readonly Extractor[] = [youtubeExtractor, pageExtractor];

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function pick(url: string, extractors: readonly Extractor[]): Extractor | undefined {
  const parsed = parse(url);
  return parsed ? extractors.find((e) => e.matches(parsed)) : undefined;
}

/** The kind badge for `url` (spec 5.2): Page unless a specific extractor matches. */
export function detectKind(url: string, extractors: readonly Extractor[] = EXTRACTORS): PinKind {
  return pick(url, extractors)?.kind ?? 'page';
}

/**
 * Extracts the content of tab `tabId` showing `url`. Restricted pages fail
 * without touching the tab. Never throws.
 */
export async function extractTab(
  tabId: number,
  url: string,
  options: { browser?: BrowserName; extractors?: readonly Extractor[] } = {},
): Promise<ExtractionResult> {
  const extractors = options.extractors ?? EXTRACTORS;
  const extractor = pick(url, extractors);
  const kind = extractor?.kind ?? 'page';
  if (!extractor || isRestrictedUrl(url, options.browser ?? CURRENT_BROWSER)) {
    return { ok: false, kind, reason: 'restricted' };
  }
  try {
    return await extractor.extract(tabId, url);
  } catch {
    return { ok: false, kind, reason: 'unreadable' };
  }
}
