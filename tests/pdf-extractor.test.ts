// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { EXTRACTORS, detectKind, extractTab } from '@/shared/extract';
import { readPdf, type PdfText } from '@/shared/extract/pdf';
import { createPdfExtractor, pdfExtractor, type PdfRunner } from '@/shared/extract/pdf-extractor';
import { onPdfRequest } from '@/shared/extract/pdf-local';
import { OFFSCREEN_PATH } from '@/shared/extract/pdf-offscreen';
import { extractionFailureMessage } from '@/shared/extract/messages';
import { useLocale } from './helpers/i18n';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/pdf');
const fixture = (name: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(readFileSync(resolve(FIXTURES, name)));

const PDF_URL = 'https://example.com/files/report.pdf';
const VIEW_URL = 'https://example.com/view?id=7';

type Results = Awaited<ReturnType<typeof fakeBrowser.scripting.executeScript>>;

const TEXT: PdfText = { ok: true, title: 'Report', text: 'Night trains.', truncated: false };

function runner(result: PdfText) {
  return vi.fn<PdfRunner>(() => Promise.resolve(result));
}

describe('createPdfExtractor', () => {
  it('matches URLs whose path ends in .pdf', () => {
    const extractor = createPdfExtractor({ run: runner(TEXT) });
    expect(extractor.matches(new URL(PDF_URL))).toBe(true);
    expect(extractor.matches(new URL(VIEW_URL))).toBe(false);
    expect(detectKind(PDF_URL)).toBe('pdf');
    expect(detectKind(VIEW_URL)).toBe('page');
  });

  it('returns the text as a PDF result', async () => {
    const run = runner(TEXT);
    const extractor = createPdfExtractor({ run });
    expect(await extractor.extract(3, PDF_URL)).toEqual({
      ok: true,
      kind: 'pdf',
      title: 'Report',
      text: 'Night trains.',
      charCount: 13,
      truncated: false,
    });
    expect(run).toHaveBeenCalledWith(PDF_URL, false);
  });

  it.each(['pdf-too-large', 'pdf-encrypted', 'pdf-no-text', 'pdf-unreadable'] as const)(
    'passes the reason %s on',
    async (reason) => {
      const extractor = createPdfExtractor({ run: runner({ ok: false, reason }) });
      expect(await extractor.extract(3, PDF_URL)).toEqual({ ok: false, kind: 'pdf', reason });
    },
  );

  it('turns a failed request into no-access without a grant for the site', async () => {
    const hasAccess = vi.fn(() => Promise.resolve(false));
    const extractor = createPdfExtractor({
      run: runner({ ok: false, reason: 'fetch-failed' }),
      hasAccess,
    });
    expect(await extractor.extract(3, PDF_URL)).toEqual({
      ok: false,
      kind: 'pdf',
      reason: 'no-access',
    });
    expect(hasAccess).toHaveBeenCalledWith(PDF_URL);
  });

  it('turns a failed request into unreadable with a grant for the site', async () => {
    const extractor = createPdfExtractor({
      run: runner({ ok: false, reason: 'fetch-failed' }),
      hasAccess: () => Promise.resolve(true),
    });
    expect(await extractor.extract(3, PDF_URL)).toMatchObject({ reason: 'pdf-unreadable' });
  });

  it('probes with the Content-Type required', async () => {
    const run = runner(TEXT);
    const extractor = createPdfExtractor({ run });
    expect(await extractor.probe(VIEW_URL)).toMatchObject({ ok: true, kind: 'pdf' });
    expect(run).toHaveBeenCalledWith(VIEW_URL, true);
  });

  it.each(['not-pdf', 'fetch-failed'] as const)(
    'a probe answering %s is no PDF',
    async (reason) => {
      const extractor = createPdfExtractor({ run: runner({ ok: false, reason }) });
      expect(await extractor.probe(VIEW_URL)).toBeNull();
    },
  );

  it('a probe that found a PDF reports its failure', async () => {
    const extractor = createPdfExtractor({ run: runner({ ok: false, reason: 'pdf-encrypted' }) });
    expect(await extractor.probe(VIEW_URL)).toEqual({
      ok: false,
      kind: 'pdf',
      reason: 'pdf-encrypted',
    });
  });

  it('is registered after YouTube and before the page extractor', () => {
    expect(EXTRACTORS.map((e) => e.kind)).toEqual(['youtube', 'pdf', 'page']);
  });
});

describe('failure messages', () => {
  it.each([
    ['pdf-too-large', "Can't read this PDF: it's larger than 30 MB."],
    ['pdf-encrypted', "Can't read this PDF: it's protected by a password."],
    ['pdf-no-text', "Can't read this PDF: it has no text, only images, as in a scan."],
    ['pdf-unreadable', "Can't read this PDF. Check that it opens in the browser"],
  ])('%s', (reason, text) => {
    useLocale('en');
    expect(extractionFailureMessage(reason)).toContain(text);
  });

  it('German', () => {
    useLocale('de');
    expect(extractionFailureMessage('pdf-encrypted')).toContain('mit einem Passwort geschützt');
  });
});

describe('onPdfRequest', () => {
  it('answers pdf-extract requests only', async () => {
    const read = vi.fn(() => Promise.resolve(TEXT));
    const reply = vi.fn();
    expect(onPdfRequest({ type: 'pins-changed', sessionId: 's1' }, reply, read)).toBe(false);
    expect(onPdfRequest({ type: 'pdf-extract', url: 'file:///a.pdf' }, reply, read)).toBe(false);
    expect(
      onPdfRequest({ type: 'pdf-extract', url: PDF_URL, requirePdfType: true }, reply, read),
    ).toBe(true);
    await vi.waitFor(() => {
      expect(reply).toHaveBeenCalledWith(TEXT);
    });
    expect(read).toHaveBeenCalledWith(PDF_URL, true);
  });

  it('answers fetch-failed when reading throws', async () => {
    const reply = vi.fn();
    onPdfRequest({ type: 'pdf-extract', url: PDF_URL, requirePdfType: false }, reply, () =>
      Promise.reject(new Error('boom')),
    );
    await vi.waitFor(() => {
      expect(reply).toHaveBeenCalledWith({ ok: false, reason: 'fetch-failed' });
    });
  });
});

/**
 * Chrome's path end to end: the offscreen API and `runtime.getContexts` are
 * faked, and the "offscreen document" answers through `onPdfRequest` with
 * pdf.js for Node and a fake server.
 */
describe('Chrome offscreen path through the dispatcher', () => {
  let documentOpen = false;
  const createDocument = vi.fn((params: { url: string; reasons: string[] }) => {
    expect(params.reasons).toEqual(['WORKERS']);
    documentOpen = true;
    return Promise.resolve();
  });
  const closeDocument = vi.fn(() => {
    documentOpen = false;
    return Promise.resolve();
  });
  const getContexts = vi.fn(() => Promise.resolve(documentOpen ? [{}] : []));
  let files: Record<string, { body: Uint8Array<ArrayBuffer> | string; type: string }> = {};
  const serverFetch = vi.fn((input: RequestInfo | URL) => {
    const file = files[input instanceof Request ? input.url : input.toString()];
    return Promise.resolve(
      file
        ? new Response(file.body, { headers: { 'content-type': file.type } })
        : new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } }),
    );
  });

  beforeEach(() => {
    fakeBrowser.reset();
    useLocale('en');
    documentOpen = false;
    files = {};
    Object.assign(fakeBrowser, { offscreen: { createDocument, closeDocument } });
    Object.assign(fakeBrowser.runtime, { getContexts });
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((message: unknown) => {
      if (!documentOpen) return Promise.reject(new Error('Receiving end does not exist.'));
      return new Promise((reply) => {
        const read = (url: string, requirePdfType: boolean) =>
          readPdf(url, { fetch: serverFetch, pdfjs, requirePdfType });
        if (!onPdfRequest(message, reply, read)) reply(undefined);
      });
    });
    vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(true);
  });

  afterEach(() => {
    createDocument.mockClear();
    closeDocument.mockClear();
    serverFetch.mockClear();
  });

  it('reads a .pdf URL in the offscreen document without injecting a script', async () => {
    files[PDF_URL] = { body: fixture('text.pdf'), type: 'application/pdf' };
    const inject = vi.spyOn(fakeBrowser.scripting, 'executeScript');
    const result = await extractTab(4, PDF_URL);
    expect(result).toMatchObject({ ok: true, kind: 'pdf', title: 'Night trains in Europe' });
    expect(result.ok && result.text).toContain('cross-border connections');
    expect(inject).not.toHaveBeenCalled();
    expect(createDocument).toHaveBeenCalledWith({
      url: fakeBrowser.runtime.getURL(OFFSCREEN_PATH),
      reasons: ['WORKERS'],
      justification: expect.any(String) as string,
    });
    expect(closeDocument).toHaveBeenCalledTimes(1);
    expect(serverFetch).toHaveBeenCalledWith(
      PDF_URL,
      expect.objectContaining({ credentials: 'omit' }),
    );
  });

  it('fails encrypted and image-only PDFs with their reasons', async () => {
    const locked = 'https://example.com/locked.pdf';
    const scan = 'https://example.com/scan.pdf';
    files[locked] = { body: fixture('encrypted.pdf'), type: 'application/pdf' };
    files[scan] = { body: fixture('image-only.pdf'), type: 'application/pdf' };
    const [a, b] = await Promise.all([extractTab(1, locked), extractTab(2, scan)]);
    expect(a).toEqual({ ok: false, kind: 'pdf', reason: 'pdf-encrypted' });
    expect(b).toEqual({ ok: false, kind: 'pdf', reason: 'pdf-no-text' });
    // Two jobs in a row share one document, closed after the last.
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(closeDocument).toHaveBeenCalledTimes(1);
  });

  it('reuses a document that is already open', async () => {
    documentOpen = true;
    files[PDF_URL] = { body: fixture('text.pdf'), type: 'application/pdf' };
    expect(await extractTab(4, PDF_URL)).toMatchObject({ ok: true });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('counts a document that cannot be created as a failed request', async () => {
    createDocument.mockRejectedValueOnce(new Error('No offscreen'));
    vi.spyOn(fakeBrowser.permissions, 'contains').mockResolvedValue(false);
    expect(await pdfExtractor.extract(4, PDF_URL)).toEqual({
      ok: false,
      kind: 'pdf',
      reason: 'no-access',
    });
  });

  it('finds a PDF behind a page URL by its Content-Type after the page extractor failed', async () => {
    files[VIEW_URL] = { body: fixture('text.pdf'), type: 'application/pdf' };
    vi.spyOn(fakeBrowser.scripting, 'executeScript').mockRejectedValue(
      new Error('Cannot access contents of the page.'),
    );
    expect(await extractTab(4, VIEW_URL)).toMatchObject({
      ok: true,
      kind: 'pdf',
      title: 'Night trains in Europe',
    });
  });

  it('keeps the page failure when the URL serves no PDF', async () => {
    files[VIEW_URL] = { body: '<p>Hello</p>', type: 'text/html' };
    vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([
      {
        frameId: 0,
        documentId: 'd',
        result: { title: '', text: '', truncated: false, method: 'innerText' },
      },
    ] as Results);
    expect(await extractTab(4, VIEW_URL)).toEqual({ ok: false, kind: 'page', reason: 'empty' });
    expect(serverFetch).toHaveBeenCalledTimes(1);
  });

  it('does not probe after a successful page extraction or for restricted pages', async () => {
    vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([
      {
        frameId: 0,
        documentId: 'd',
        result: { title: 'A', text: 'Text', truncated: false, method: 'innerText' },
      },
    ] as Results);
    expect(await extractTab(4, VIEW_URL)).toMatchObject({ ok: true, kind: 'page' });
    expect(await extractTab(4, 'chrome://settings/', { browser: 'chrome' })).toMatchObject({
      reason: 'restricted',
    });
    expect(serverFetch).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('can run without the probe', async () => {
    files[VIEW_URL] = { body: fixture('text.pdf'), type: 'application/pdf' };
    vi.spyOn(fakeBrowser.scripting, 'executeScript').mockRejectedValue(new Error('Nope'));
    expect(await extractTab(4, VIEW_URL, { probe: null })).toEqual({
      ok: false,
      kind: 'page',
      reason: 'unreadable',
    });
  });
});
