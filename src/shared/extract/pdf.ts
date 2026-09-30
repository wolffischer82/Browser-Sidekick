import type * as PdfJsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { MAX_TEXT_CHARS, capText } from './cap';

/**
 * PDF detection, the size-limited re-fetch and text extraction with pdf.js
 * (spec 5.5). Pure apart from the injected `fetch` and pdf.js, so it runs the
 * same in Chrome's offscreen document, Firefox's background page and Node
 * tests. The text goes back to the caller only; nothing is logged.
 */

/** Larger PDFs are refused (spec 5.5, "too large > 30 MB"). */
export const MAX_PDF_BYTES = 30 * 1024 * 1024;

/** Download plus parsing; a stuck server or a pathological file gives up after this. */
export const PDF_TIMEOUT_MS = 60_000;

/**
 * Why a PDF can't be read; stored as `Pin.failureReason` and localised by
 * `extractionFailureMessage`.
 */
export type PdfFailure = 'pdf-too-large' | 'pdf-encrypted' | 'pdf-no-text' | 'pdf-unreadable';

/**
 * `fetch-failed`: the request itself failed (offline, CORS, no host access),
 * which the caller turns into `no-access` or `pdf-unreadable`. `not-pdf`: the
 * response isn't `application/pdf` although the caller required it.
 */
export type PdfReadFailure = PdfFailure | 'fetch-failed' | 'not-pdf';

export type PdfText =
  | { ok: true; title: string; text: string; truncated: boolean }
  | { ok: false; reason: PdfReadFailure };

export type PdfDownload = { ok: true; data: Uint8Array } | { ok: false; reason: PdfReadFailure };

/** The part of pdf.js this module uses; tests pass the Node build. */
export type PdfJs = Pick<typeof PdfJsLib, 'getDocument'>;

const PDF_FAILURES: readonly string[] = [
  'pdf-too-large',
  'pdf-encrypted',
  'pdf-no-text',
  'pdf-unreadable',
  'fetch-failed',
  'not-pdf',
];

/** Runtime guard for a `PdfText` that crossed a context boundary (the offscreen reply). */
export function isPdfText(value: unknown): value is PdfText {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.ok === true) {
    return (
      typeof v.title === 'string' && typeof v.text === 'string' && typeof v.truncated === 'boolean'
    );
  }
  return v.ok === false && typeof v.reason === 'string' && PDF_FAILURES.includes(v.reason);
}

/** Detection by URL (spec 5.5): an http(s) URL whose path ends in `.pdf`. */
export function isPdfUrl(url: URL): boolean {
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.pathname.toLowerCase().endsWith('.pdf')
  );
}

/** Detection by response (spec 5.5): `Content-Type: application/pdf`, parameters ignored. */
export function isPdfContentType(value: string | null): boolean {
  if (value === null) return false;
  return value.split(';', 1)[0]?.trim().toLowerCase() === 'application/pdf';
}

export interface DownloadOptions {
  fetch: typeof fetch;
  signal?: AbortSignal;
  /** Refuse a response that isn't `application/pdf` (detection by response). */
  requirePdfType?: boolean;
  maxBytes?: number;
}

/**
 * Re-fetches `url` from the extension (spec 5.5) with no cookies, credentials
 * or referrer. A `Content-Length` over the limit is refused before the body is
 * read; without one, the stream is cancelled as soon as the limit is passed.
 */
export async function downloadPdf(url: string, options: DownloadOptions): Promise<PdfDownload> {
  const maxBytes = options.maxBytes ?? MAX_PDF_BYTES;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  // Ends the request, and a pending read of a stalled body, at the time limit.
  const stop = () => {
    controller.abort();
    reader?.cancel().catch(() => undefined);
  };
  options.signal?.addEventListener('abort', stop, { once: true });
  const aborted = () => options.signal?.aborted === true;
  try {
    let response: Response;
    try {
      response = await options.fetch(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'default',
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch {
      // Offline, CORS, no host access, or the time limit before any response.
      return { ok: false, reason: 'fetch-failed' };
    }
    const discard = () => {
      controller.abort();
      response.body?.cancel().catch(() => undefined);
    };
    // Checked first, so a probe of an ordinary page (even an error page) never
    // turns into a PDF failure.
    if (options.requirePdfType && !isPdfContentType(response.headers.get('content-type'))) {
      discard();
      return { ok: false, reason: 'not-pdf' };
    }
    if (!response.ok) {
      discard();
      return { ok: false, reason: 'pdf-unreadable' };
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      discard();
      return { ok: false, reason: 'pdf-too-large' };
    }
    if (!response.body || aborted()) {
      discard();
      return { ok: false, reason: 'pdf-unreadable' };
    }

    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        return { ok: false, reason: 'pdf-unreadable' };
      }
      if (aborted()) return { ok: false, reason: 'pdf-unreadable' };
      if (chunk.done) break;
      total += chunk.value.length;
      if (total > maxBytes) {
        stop();
        return { ok: false, reason: 'pdf-too-large' };
      }
      chunks.push(chunk.value);
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return { ok: true, data };
  } finally {
    options.signal?.removeEventListener('abort', stop);
  }
}

interface TextItemLike {
  str?: unknown;
  hasEOL?: unknown;
}

/** One page's text: items in reading order, a line break where pdf.js marks one. */
function pageText(items: readonly TextItemLike[]): string {
  let text = '';
  for (const item of items) {
    if (typeof item.str === 'string') text += item.str;
    if (item.hasEOL === true) text += '\n';
  }
  return text
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function metadataTitle(info: unknown): string {
  if (typeof info !== 'object' || info === null) return '';
  const title = (info as Record<string, unknown>).Title;
  return typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
}

function rejectOnAbort(signal: AbortSignal | undefined): Promise<never> | null {
  if (!signal) return null;
  return new Promise<never>((_resolve, reject) => {
    const fail = () => {
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

/**
 * Extracts the text of a PDF with pdf.js: pages in order, separated by a blank
 * line, read until the per-pin cap is reached. Options that could run code
 * from the file (eval, XFA) or reach the network (range requests, fonts,
 * CMaps) are off. Never throws.
 */
export async function pdfToText(
  data: Uint8Array,
  pdfjs: PdfJs,
  options: { maxChars?: number; signal?: AbortSignal } = {},
): Promise<PdfText> {
  const maxChars = options.maxChars ?? MAX_TEXT_CHARS;
  if (options.signal?.aborted) return { ok: false, reason: 'pdf-unreadable' };
  let task: ReturnType<PdfJs['getDocument']>;
  try {
    task = pdfjs.getDocument({
      data,
      isEvalSupported: false,
      enableXfa: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
      isOffscreenCanvasSupported: false,
      stopAtErrors: false,
      // Errors only; pdf.js never logs page content.
      verbosity: 0,
    });
  } catch {
    return { ok: false, reason: 'pdf-unreadable' };
  }
  const abort = rejectOnAbort(options.signal);
  // Only raced below; an abort after the work is done is nobody's error.
  abort?.catch(() => undefined);
  const guard = <T>(promise: Promise<T>): Promise<T> =>
    abort ? Promise.race([promise, abort]) : promise;
  try {
    const doc = await guard(task.promise);
    const metadata = await guard(doc.getMetadata()).catch(() => null);
    const pages: string[] = [];
    let length = 0;
    for (let n = 1; n <= doc.numPages && length <= maxChars; n++) {
      const page = await guard(doc.getPage(n));
      const content = await guard(page.getTextContent());
      page.cleanup();
      const text = pageText(content.items as TextItemLike[]);
      if (text === '') continue;
      pages.push(text);
      length += text.length + 2;
    }
    const joined = pages.join('\n\n');
    if (joined === '') return { ok: false, reason: 'pdf-no-text' };
    const capped = capText(joined, maxChars);
    return {
      ok: true,
      title: metadataTitle(metadata?.info),
      text: capped.text,
      truncated: capped.truncated,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { ok: false, reason: name === 'PasswordException' ? 'pdf-encrypted' : 'pdf-unreadable' };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

export interface ReadPdfOptions {
  fetch: typeof fetch;
  pdfjs: PdfJs;
  requirePdfType?: boolean;
  timeoutMs?: number;
}

/** Downloads and extracts `url`, within the time limit. Never throws. */
export async function readPdf(url: string, options: ReadPdfOptions): Promise<PdfText> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? PDF_TIMEOUT_MS);
  try {
    const download = await downloadPdf(url, {
      fetch: options.fetch,
      signal: controller.signal,
      requirePdfType: options.requirePdfType,
    });
    if (!download.ok) return download;
    return await pdfToText(download.data, options.pdfjs, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
