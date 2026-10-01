import { browser } from 'wxt/browser';
import type { PdfExtractRequest } from '../messages';
import { isPdfText, type PdfText } from './pdf';

/**
 * Chrome's PDF path (spec 5.5, 6 "Contexts"): the service worker can't start
 * pdf.js's worker, so an offscreen document downloads and parses the PDF. The
 * document is created for a job and closed once no job is left. Jobs run one
 * at a time.
 */

export const OFFSCREEN_PATH = '/offscreen.html';

const JUSTIFICATION = 'Reads the text of PDF files the user pins, with pdf.js in a worker.';

const NOT_READ: PdfText = { ok: false, reason: 'fetch-failed' };

async function hasDocument(url: string): Promise<boolean> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url],
  });
  return contexts.length > 0;
}

async function ensureDocument(): Promise<void> {
  const url = browser.runtime.getURL(OFFSCREEN_PATH);
  if (await hasDocument(url)) return;
  try {
    await browser.offscreen.createDocument({
      url,
      reasons: ['WORKERS'],
      justification: JUSTIFICATION,
    });
  } catch (error) {
    // Another extension page may have created it meanwhile.
    if (!(await hasDocument(url))) throw error;
  }
}

let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

async function runJob(message: PdfExtractRequest): Promise<PdfText> {
  try {
    await ensureDocument();
    const reply: unknown = await browser.runtime.sendMessage(message);
    return isPdfText(reply) ? reply : NOT_READ;
  } catch {
    return NOT_READ;
  } finally {
    pending -= 1;
    if (pending === 0) await browser.offscreen.closeDocument().catch(() => undefined);
  }
}

/**
 * Reads the PDF at `url` in the offscreen document. Never throws; when the
 * document can't be used the PDF counts as not fetched (`fetch-failed`).
 */
export function readPdfOffscreen(url: string, requirePdfType: boolean): Promise<PdfText> {
  pending += 1;
  const job = queue.then(() => runJob({ type: 'pdf-extract', url, requirePdfType }));
  queue = job;
  return job;
}
