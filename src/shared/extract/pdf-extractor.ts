import type { ExtractionFailure, ExtractionResult, Extractor } from '.';
import { hasSiteAccess } from '../page-access';
import { isPdfUrl, type PdfText } from './pdf';
import { readPdfOffscreen } from './pdf-offscreen';

/**
 * PDFs (spec 5.5). Detection by URL picks this extractor before any script is
 * injected, because the browsers' PDF viewers can't be scripted. Detection by
 * `Content-Type` is the dispatcher's probe after the page extractor failed.
 * Method: decisions.md T09.
 */

/** Downloads and reads a PDF; `requirePdfType` refuses other content types. */
export type PdfRunner = (url: string, requirePdfType: boolean) => Promise<PdfText>;

/** Chrome: the offscreen document. Firefox: pdf.js in the background page itself. */
export const defaultPdfRunner: PdfRunner = async (url, requirePdfType) => {
  if (import.meta.env.FIREFOX) {
    const { readPdfHere } = await import('./pdf-local');
    return readPdfHere(url, requirePdfType);
  }
  return readPdfOffscreen(url, requirePdfType);
};

const failed = (reason: ExtractionFailure): ExtractionResult => ({
  ok: false,
  kind: 'pdf',
  reason,
});

function toResult(pdf: Extract<PdfText, { ok: true }>): ExtractionResult {
  return {
    ok: true,
    kind: 'pdf',
    title: pdf.title,
    text: pdf.text,
    charCount: pdf.text.length,
    truncated: pdf.truncated,
  };
}

export interface PdfExtractorDeps {
  run?: PdfRunner;
  /** Whether a failed request means missing access rather than a download error. */
  hasAccess?: (url: string) => Promise<boolean>;
}

export interface PdfExtractor extends Extractor {
  /**
   * Detection by response: reads `url` as a PDF only if the server says it is
   * one. `null` when it isn't, or when it can't be fetched.
   */
  probe: (url: string) => Promise<ExtractionResult | null>;
}

export function createPdfExtractor(deps: PdfExtractorDeps = {}): PdfExtractor {
  const run = deps.run ?? defaultPdfRunner;
  const hasAccess = deps.hasAccess ?? hasSiteAccess;
  return {
    kind: 'pdf',
    matches: isPdfUrl,
    async extract(_tabId, url) {
      const pdf = await run(url, false);
      if (pdf.ok) return toResult(pdf);
      if (pdf.reason === 'fetch-failed') {
        const access = await hasAccess(url).catch(() => false);
        return failed(access ? 'pdf-unreadable' : 'no-access');
      }
      return failed(pdf.reason === 'not-pdf' ? 'pdf-unreadable' : pdf.reason);
    },
    async probe(url) {
      const pdf = await run(url, true);
      if (pdf.ok) return toResult(pdf);
      if (pdf.reason === 'fetch-failed' || pdf.reason === 'not-pdf') return null;
      return failed(pdf.reason);
    },
  };
}

export const pdfExtractor = createPdfExtractor();
