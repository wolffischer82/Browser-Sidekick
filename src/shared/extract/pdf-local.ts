import { browser } from 'wxt/browser';
import { isSidekickMessage } from '../messages';
import { readPdf, type PdfJs, type PdfText } from './pdf';

/**
 * Runs pdf.js in the current document: Firefox's background page and Chrome's
 * offscreen document (spec 5.5, 6 "Contexts"). pdf.js parses in its worker,
 * a packaged extension file (`wxt.config.ts`), never a remote one.
 */

/** The pdf.js worker as copied into the build by `wxt.config.ts`. */
export const PDF_WORKER_PATH = '/pdf.worker.js';

let loaded: Promise<PdfJs> | null = null;

function loadPdfjs(): Promise<PdfJs> {
  loaded ??= import('pdfjs-dist/legacy/build/pdf.mjs').then(
    (lib) => {
      // The worker isn't in `public/`, so WXT's typed paths don't know it.
      lib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL(PDF_WORKER_PATH as '/');
      return lib;
    },
    (error: unknown) => {
      loaded = null;
      throw error;
    },
  );
  return loaded;
}

/**
 * Downloads and reads the PDF at `url`. Never throws; if pdf.js can't be
 * loaded the PDF counts as not fetched (`fetch-failed`), so a Content-Type
 * probe keeps the page's own result.
 */
export async function readPdfHere(url: string, requirePdfType: boolean): Promise<PdfText> {
  let pdfjs: PdfJs;
  try {
    pdfjs = await loadPdfjs();
  } catch {
    return { ok: false, reason: 'fetch-failed' };
  }
  return readPdf(url, {
    fetch: (input, init) => fetch(input, init),
    pdfjs,
    requirePdfType,
  });
}

/**
 * The offscreen document's `runtime.onMessage` listener: answers
 * `pdf-extract` requests only, and leaves every other message alone.
 */
export function onPdfRequest(
  message: unknown,
  sendResponse: (response: PdfText) => void,
  read: typeof readPdfHere = readPdfHere,
): boolean {
  if (!isSidekickMessage(message) || message.type !== 'pdf-extract') return false;
  read(message.url, message.requirePdfType).then(sendResponse, () => {
    sendResponse({ ok: false, reason: 'fetch-failed' });
  });
  return true;
}
