import { extractTab, pageExtractor, type Extractor, type ExtractionResult } from '../extract';
import { readPdfHere } from '../extract/pdf-local';
import { createPdfExtractor, type PdfRunner } from '../extract/pdf-extractor';
import { youtubeExtractor } from '../extract/youtube-extractor';
import type { CurrentTabRef, RequestPage } from './context';

/**
 * The current tab, read on demand when a question is sent (spec 5.5, 5.6).
 * Its text goes into that one request and is never stored.
 *
 * The sidebar runs the extractor dispatcher itself. PDFs are read with
 * pdf.js right here in the sidebar, in both browsers: the sidebar is a
 * document that can start pdf.js's worker, so Chrome's offscreen document
 * (which the background uses) isn't needed, and the text never crosses a
 * message channel (decisions.md T10).
 */

export interface CurrentTabDeps {
  /** Reads a PDF; defaults to pdf.js in this document. */
  runPdf?: PdfRunner;
  extract?: (tabId: number, url: string) => Promise<ExtractionResult>;
}

function sidebarExtract(runPdf: PdfRunner) {
  const pdf = createPdfExtractor({ run: runPdf });
  const extractors: readonly Extractor[] = [youtubeExtractor, pdf, pageExtractor];
  return (tabId: number, url: string) => extractTab(tabId, url, { extractors, probe: pdf.probe });
}

/** The current tab's content for a request, or `null` if it can't be read. Never throws. */
export async function readCurrentTabText(
  tab: CurrentTabRef,
  deps: CurrentTabDeps = {},
): Promise<RequestPage | null> {
  const extract = deps.extract ?? sidebarExtract(deps.runPdf ?? readPdfHere);
  try {
    const result = await extract(tab.tabId, tab.url);
    if (!result.ok) return null;
    return { title: tab.title || result.title || tab.url, url: tab.url, text: result.text };
  } catch {
    return null;
  }
}
