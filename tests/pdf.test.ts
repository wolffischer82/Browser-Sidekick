// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it, vi } from 'vitest';
import { MAX_TEXT_CHARS } from '@/shared/extract/cap';
import {
  MAX_PDF_BYTES,
  downloadPdf,
  isPdfContentType,
  isPdfUrl,
  pdfToText,
  readPdf,
} from '@/shared/extract/pdf';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/pdf');
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));

const URL_A = 'https://example.com/files/report.pdf';

function pdfResponse(body: BodyInit | null, headers: Record<string, string> = {}, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/pdf', ...headers },
  });
}

/** A body that yields `chunks` chunks of `size` bytes and records whether it was cancelled. */
function chunkedBody(chunks: number, size: number) {
  const state = { sent: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.sent === chunks) {
        controller.close();
        return;
      }
      state.sent += 1;
      controller.enqueue(new Uint8Array(size));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

describe('isPdfUrl', () => {
  it.each([
    ['https://example.com/report.pdf', true],
    ['https://example.com/Files/REPORT.PDF', true],
    ['http://127.0.0.1:8080/a/b.pdf?download=1#page=2', true],
    ['https://example.com/report.pdf/', false],
    ['https://example.com/report.pdfx', false],
    ['https://example.com/view?file=report.pdf', false],
    ['https://example.com/pdf', false],
    ['https://example.com/', false],
    ['file:///home/me/report.pdf', false],
    ['ftp://example.com/report.pdf', false],
  ])('%s -> %s', (url, expected) => {
    expect(isPdfUrl(new URL(url))).toBe(expected);
  });
});

describe('isPdfContentType', () => {
  it.each([
    ['application/pdf', true],
    ['Application/PDF', true],
    ['application/pdf; charset=binary', true],
    [' application/pdf ', true],
    ['application/octet-stream', false],
    ['text/html; charset=utf-8', false],
    ['application/pdfx', false],
    ['', false],
    [null, false],
  ])('%s -> %s', (value, expected) => {
    expect(isPdfContentType(value)).toBe(expected);
  });
});

describe('downloadPdf', () => {
  it('fetches without credentials or referrer and returns the bytes', async () => {
    const data = fixture('text.pdf');
    const fetchMock = vi.fn(() => Promise.resolve(pdfResponse(data)));
    const result = await downloadPdf(URL_A, { fetch: fetchMock });
    expect(result).toEqual({ ok: true, data });
    expect(fetchMock).toHaveBeenCalledWith(
      URL_A,
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }),
    );
  });

  it('refuses a Content-Length over 30 MB without reading the body', async () => {
    const { stream, state } = chunkedBody(1, 16);
    const fetchMock = vi.fn(() =>
      Promise.resolve(pdfResponse(stream, { 'content-length': String(MAX_PDF_BYTES + 1) })),
    );
    expect(await downloadPdf(URL_A, { fetch: fetchMock })).toEqual({
      ok: false,
      reason: 'pdf-too-large',
    });
    expect(state.sent).toBeLessThanOrEqual(1);
    expect(state.cancelled).toBe(true);
  });

  it('aborts the stream once more than the limit has arrived', async () => {
    const { stream, state } = chunkedBody(100, 1024);
    const fetchMock = vi.fn(() => Promise.resolve(pdfResponse(stream)));
    expect(await downloadPdf(URL_A, { fetch: fetchMock, maxBytes: 10 * 1024 })).toEqual({
      ok: false,
      reason: 'pdf-too-large',
    });
    expect(state.cancelled).toBe(true);
    expect(state.sent).toBeLessThan(100);
  });

  it('accepts a body of exactly the limit', async () => {
    const { stream } = chunkedBody(10, 1024);
    const fetchMock = vi.fn(() => Promise.resolve(pdfResponse(stream)));
    const result = await downloadPdf(URL_A, { fetch: fetchMock, maxBytes: 10 * 1024 });
    expect(result.ok && result.data.length).toBe(10 * 1024);
  });

  it('reports a failed request as fetch-failed (network, CORS or no access)', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await downloadPdf(URL_A, { fetch: fetchMock })).toEqual({
      ok: false,
      reason: 'fetch-failed',
    });
  });

  it('reports an HTTP error as unreadable', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(pdfResponse('gone', {}, 404)));
    expect(await downloadPdf(URL_A, { fetch: fetchMock })).toEqual({
      ok: false,
      reason: 'pdf-unreadable',
    });
  });

  it('reports an error page as not-pdf when the type is required', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response('<p>gone</p>', { status: 404, headers: { 'content-type': 'text/html' } }),
      ),
    );
    expect(await downloadPdf(URL_A, { fetch: fetchMock, requirePdfType: true })).toEqual({
      ok: false,
      reason: 'not-pdf',
    });
  });

  it('checks the Content-Type only when asked to', async () => {
    const html = () =>
      Promise.resolve(new Response('<p>hi</p>', { headers: { 'content-type': 'text/html' } }));
    expect(await downloadPdf(URL_A, { fetch: vi.fn(html), requirePdfType: true })).toEqual({
      ok: false,
      reason: 'not-pdf',
    });
    expect(await downloadPdf(URL_A, { fetch: vi.fn(html) })).toMatchObject({ ok: true });
  });

  it('stops reading when the signal aborts', async () => {
    const controller = new AbortController();
    const { stream, state } = chunkedBody(1000, 1024);
    const fetchMock = vi.fn(() => {
      controller.abort();
      return Promise.resolve(pdfResponse(stream));
    });
    expect(await downloadPdf(URL_A, { fetch: fetchMock, signal: controller.signal })).toEqual({
      ok: false,
      reason: 'pdf-unreadable',
    });
    expect(state.sent).toBeLessThan(1000);
  });
});

describe('pdfToText', () => {
  it('extracts the text of every page, in order, and the title', async () => {
    const result = await pdfToText(fixture('text.pdf'), pdfjs);
    expect(result).toEqual({
      ok: true,
      title: 'Night trains in Europe',
      text:
        'Night trains in Europe\nSleeper services returned to many routes this year.\n' +
        'Most of them run between capitals.\n\n' +
        'Operators plan more cross-border connections for the winter timetable.',
      truncated: false,
    });
  });

  it('fails a password-protected PDF as encrypted', async () => {
    expect(await pdfToText(fixture('encrypted.pdf'), pdfjs)).toEqual({
      ok: false,
      reason: 'pdf-encrypted',
    });
  });

  it('fails an image-only PDF (a scan) as having no text', async () => {
    expect(await pdfToText(fixture('image-only.pdf'), pdfjs)).toEqual({
      ok: false,
      reason: 'pdf-no-text',
    });
  });

  it('fails a file that is not a PDF as unreadable', async () => {
    const html = new TextEncoder().encode('<!doctype html><p>Not a PDF</p>');
    expect(await pdfToText(html, pdfjs)).toEqual({ ok: false, reason: 'pdf-unreadable' });
    expect(await pdfToText(new Uint8Array(0), pdfjs)).toEqual({
      ok: false,
      reason: 'pdf-unreadable',
    });
  });

  it('caps the text and stops reading pages beyond the cap', async () => {
    const result = await pdfToText(fixture('text.pdf'), pdfjs, { maxChars: 30 });
    expect(result).toEqual({
      ok: true,
      title: 'Night trains in Europe',
      text: 'Night trains in Europe\nSleeper',
      truncated: true,
    });
    expect(MAX_TEXT_CHARS).toBe(200_000);
  });

  it('turns load options off that could run code or reach the network', async () => {
    const getDocument = vi.fn(pdfjs.getDocument);
    await pdfToText(fixture('text.pdf'), { getDocument });
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        isEvalSupported: false,
        enableXfa: false,
        disableFontFace: true,
        useSystemFonts: false,
        useWorkerFetch: false,
        disableAutoFetch: true,
        disableStream: true,
        disableRange: true,
      }),
    );
  });

  it('gives up when the signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await pdfToText(fixture('text.pdf'), pdfjs, { signal: controller.signal })).toEqual({
      ok: false,
      reason: 'pdf-unreadable',
    });
  });
});

describe('readPdf', () => {
  it('downloads and extracts a text PDF', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(pdfResponse(fixture('text.pdf'))));
    expect(await readPdf(URL_A, { fetch: fetchMock, pdfjs })).toMatchObject({
      ok: true,
      title: 'Night trains in Europe',
      truncated: false,
    });
  });

  it('passes download failures on', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(pdfResponse(null, { 'content-length': String(MAX_PDF_BYTES * 2) })),
    );
    expect(await readPdf(URL_A, { fetch: fetchMock, pdfjs })).toEqual({
      ok: false,
      reason: 'pdf-too-large',
    });
  });

  it('reports a page that is not a PDF as not-pdf when the type is required', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('<p>hi</p>', { headers: { 'content-type': 'text/html' } })),
    );
    expect(await readPdf(URL_A, { fetch: fetchMock, pdfjs, requirePdfType: true })).toEqual({
      ok: false,
      reason: 'not-pdf',
    });
  });

  it('gives up after the time limit', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      );
      const pending = readPdf(URL_A, { fetch: fetchMock, pdfjs, timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toEqual({ ok: false, reason: 'fetch-failed' });

      // The response has arrived, but the body stalls.
      const stalled = vi.fn(() =>
        Promise.resolve(pdfResponse(new ReadableStream<Uint8Array>({ pull: () => undefined }))),
      );
      const reading = readPdf(URL_A, { fetch: stalled, pdfjs, timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await reading).toEqual({ ok: false, reason: 'pdf-unreadable' });
    } finally {
      vi.useRealTimers();
    }
  });
});
