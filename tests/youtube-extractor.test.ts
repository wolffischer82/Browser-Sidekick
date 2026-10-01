import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { EXTRACTORS, detectKind, extractTab } from '@/shared/extract';
import { MAX_TEXT_CHARS } from '@/shared/extract/cap';
import { youtubeExtractor } from '@/shared/extract/youtube-extractor';
import { fetchTranscriptPanel, readWatchPage } from '@/shared/extract/youtube-page';
import { useLocale } from './helpers/i18n';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/youtube');
const fixture = (name: string) => readFileSync(resolve(FIXTURES, name), 'utf8');
const PAGES: Record<string, string> = {
  VIDEO000001: fixture('watch-captions.html'),
  VIDEO000002: fixture('watch-no-captions.html'),
};
const PANEL = fixture('panel.json');

const CAPTIONED = 'https://www.youtube.com/watch?v=VIDEO000001';
const SILENT = 'https://www.youtube.com/watch?v=VIDEO000002';
const PAGE_CONTEXT = { client: { hl: 'en', clientName: 'WEB', clientVersion: '2.20260930.00.00' } };

type Results = Awaited<ReturnType<typeof fakeBrowser.scripting.executeScript>>;
type Injection = { func?: (...args: unknown[]) => unknown; args?: unknown[]; world?: string };

/** A fake YouTube origin: the watch pages and `get_panel` from the fixtures. */
function youtubeServer(options: { panelStatus?: number; panel?: string } = {}) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const url = new URL(input, 'https://www.youtube.com/');
    if (url.pathname === '/watch') {
      const html = PAGES[url.searchParams.get('v') ?? ''];
      return Promise.resolve(new Response(html ?? 'Not found', { status: html ? 200 : 404 }));
    }
    if (url.pathname === '/youtubei/v1/get_panel' && init?.method === 'POST') {
      return Promise.resolve(
        new Response(options.panel ?? PANEL, { status: options.panelStatus ?? 200 }),
      );
    }
    return Promise.resolve(new Response('', { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function panelRequest(fetchMock: ReturnType<typeof youtubeServer>) {
  const call = fetchMock.mock.calls.find(([url]) => url.startsWith('/youtubei/'));
  const body = call?.[1]?.body;
  return typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : undefined;
}

/** `executeScript` that runs the injected function here, like the MAIN world would. */
function runInjected() {
  return vi.spyOn(fakeBrowser.scripting, 'executeScript').mockImplementation(async (injection) => {
    const { func, args = [] } = injection as Injection;
    const result = func ? await func(...args) : undefined;
    return [{ frameId: 0, documentId: 'd', result }] as Results;
  });
}

function setPage(language: string, context: unknown = PAGE_CONTEXT) {
  const values: Record<string, unknown> = { HL: language, INNERTUBE_CONTEXT: context };
  vi.stubGlobal('ytcfg', { get: (key: string) => values[key] });
}

beforeEach(() => {
  fakeBrowser.reset();
  useLocale('en');
  setPage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readWatchPage (MAIN world)', () => {
  it("fetches the watch page afresh and reads the page's language and context", async () => {
    const fetchMock = youtubeServer();
    const raw = await readWatchPage('VIDEO000001');
    expect(fetchMock).toHaveBeenCalledWith('/watch?v=VIDEO000001', { credentials: 'same-origin' });
    expect(raw).toEqual({ language: 'en', context: PAGE_CONTEXT, html: PAGES.VIDEO000001 });
    expect(raw.context).not.toBe(PAGE_CONTEXT);
  });

  it('falls back to <html lang> and copes with a missing or hostile ytcfg', async () => {
    youtubeServer();
    document.documentElement.lang = 'de-DE';
    vi.stubGlobal('ytcfg', undefined);
    expect(await readWatchPage('VIDEO000002')).toMatchObject({ language: 'de-DE', context: null });
    vi.stubGlobal('ytcfg', {
      get: () => {
        throw new Error('nope');
      },
    });
    expect(await readWatchPage('VIDEO000002')).toMatchObject({ language: 'de-DE', context: null });
    document.documentElement.lang = '';
  });

  it('returns no HTML when the request fails', async () => {
    youtubeServer();
    expect((await readWatchPage('VIDEO000404')).html).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect((await readWatchPage('VIDEO000001')).html).toBeNull();
  });
});

describe('fetchTranscriptPanel (MAIN world)', () => {
  it('posts the panel request and returns the JSON', async () => {
    const fetchMock = youtubeServer();
    const panel = await fetchTranscriptPanel('PAmodern_transcript_view', 'P1', PAGE_CONTEXT);
    expect(panel).toEqual(JSON.parse(PANEL));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/youtubei/v1/get_panel?prettyPrint=false');
    expect(panelRequest(fetchMock)).toEqual({
      context: PAGE_CONTEXT,
      panelId: 'PAmodern_transcript_view',
      params: 'P1',
    });
  });

  it('returns null on an error status or a network failure', async () => {
    youtubeServer({ panelStatus: 400, panel: '{"error":{"status":"FAILED_PRECONDITION"}}' });
    expect(await fetchTranscriptPanel('PAmodern_transcript_view', 'P1', {})).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await fetchTranscriptPanel('PAmodern_transcript_view', 'P1', {})).toBeNull();
  });
});

describe('youtubeExtractor', () => {
  it('pins a captioned video with its transcript, both requests in the MAIN world', async () => {
    const fetchMock = youtubeServer();
    const spy = runInjected();
    const result = await extractTab(4, CAPTIONED);
    expect(result).toMatchObject({
      ok: true,
      kind: 'youtube',
      title: 'Placeholder captioned video',
      truncated: false,
    });
    if (!result.ok) throw new Error('expected a transcript');
    expect(result.text.split('\n')).toEqual([
      '[00:01] This is a synthetic first sentence. It stands in for real captions. Each segment has a timestamp. Markers appear about every thirty seconds.',
      '[00:33] This line starts a new block. Whitespace is collapsed.',
      '[01:05] A later block begins here.',
      '[01:40] The last synthetic line.',
    ]);
    expect(result.charCount).toBe(result.text.length);
    expect(spy).toHaveBeenCalledTimes(2);
    for (const [injection] of spy.mock.calls) {
      expect(injection).toMatchObject({ target: { tabId: 4 }, world: 'MAIN' });
    }
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ func: readWatchPage, args: ['VIDEO000001'] });
    expect(panelRequest(fetchMock)).toMatchObject({
      panelId: 'PAmodern_transcript_view',
      params: 'PANEL_PARAMS_VIDEO000001',
      context: { client: { hl: 'en', clientName: 'WEB' } },
    });
  });

  it("asks for the track in the page's language", async () => {
    const fetchMock = youtubeServer();
    runInjected();
    setPage('de');
    await extractTab(4, CAPTIONED);
    expect(panelRequest(fetchMock)).toMatchObject({ context: { client: { hl: 'de-DE' } } });
  });

  it('asks for the first track when the page language has none', async () => {
    const fetchMock = youtubeServer();
    runInjected();
    setPage('fr');
    await extractTab(4, CAPTIONED);
    expect(panelRequest(fetchMock)).toMatchObject({ context: { client: { hl: 'en' } } });
  });

  it("builds a minimal context when the page's is missing", async () => {
    const fetchMock = youtubeServer();
    runInjected();
    setPage('en', null);
    await extractTab(4, CAPTIONED);
    expect(panelRequest(fetchMock)).toMatchObject({
      context: { client: { clientName: 'WEB', clientVersion: '2.20260930.00.00', hl: 'en' } },
    });
  });

  it('pins a video without captions with title, description and the note', async () => {
    const fetchMock = youtubeServer();
    const spy = runInjected();
    expect(await extractTab(4, SILENT)).toEqual({
      ok: true,
      kind: 'youtube',
      title: 'Placeholder silent video',
      text: 'Placeholder silent video\n\nSynthetic footage without speech.\n\nNo transcript available.',
      charCount: 85,
      truncated: false,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(panelRequest(fetchMock)).toBeUndefined();
  });

  it('writes the note in the UI language', async () => {
    youtubeServer();
    runInjected();
    useLocale('de');
    const result = await extractTab(4, SILENT);
    expect(result.ok && result.text.endsWith('\n\nKein Transkript verfügbar.')).toBe(true);
  });

  it('falls back when the transcript request fails or has no segments', async () => {
    for (const options of [
      { panelStatus: 400, panel: '{"error":{"status":"FAILED_PRECONDITION"}}' },
      { panel: '{"content":{}}' },
      { panel: 'not json' },
    ]) {
      youtubeServer(options);
      runInjected();
      const result = await extractTab(4, CAPTIONED);
      expect(result).toMatchObject({ ok: true, kind: 'youtube' });
      expect(
        result.ok && result.text.startsWith('Placeholder captioned video\n\nA synthetic'),
      ).toBe(true);
      expect(result.ok && result.text.endsWith('No transcript available.')).toBe(true);
    }
  });

  it('falls back when the panel injection itself fails', async () => {
    youtubeServer();
    const spy = runInjected();
    spy.mockImplementationOnce(async (injection) => {
      const { func, args = [] } = injection as Injection;
      return [{ frameId: 0, documentId: 'd', result: await func?.(...args) }] as Results;
    });
    spy.mockRejectedValueOnce(new Error('Frame was removed'));
    expect(await extractTab(4, CAPTIONED)).toMatchObject({
      ok: true,
      text: expect.stringContaining('No transcript available.') as unknown,
    });
  });

  it('reads the video in the tab URL after in-app navigation, not stale page globals', async () => {
    const fetchMock = youtubeServer();
    runInjected();
    // The page still carries the first video's globals after YouTube's in-app navigation.
    vi.stubGlobal('ytInitialPlayerResponse', { videoDetails: { videoId: 'VIDEO000001' } });
    expect(await extractTab(4, SILENT)).toMatchObject({
      ok: true,
      title: 'Placeholder silent video',
    });
    expect(fetchMock).toHaveBeenCalledWith('/watch?v=VIDEO000002', { credentials: 'same-origin' });
    expect(await extractTab(4, CAPTIONED)).toMatchObject({
      ok: true,
      title: 'Placeholder captioned video',
      text: expect.stringMatching(/^\[00:01\] /) as unknown,
    });
  });

  it('handles Shorts and youtu.be links through the watch page', async () => {
    const fetchMock = youtubeServer();
    runInjected();
    expect(await extractTab(4, 'https://www.youtube.com/shorts/VIDEO000001')).toMatchObject({
      ok: true,
      kind: 'youtube',
      text: expect.stringMatching(/^\[00:01\] /) as unknown,
    });
    expect(await extractTab(4, 'https://youtu.be/VIDEO000002')).toMatchObject({
      ok: true,
      title: 'Placeholder silent video',
    });
    expect(fetchMock).toHaveBeenCalledWith('/watch?v=VIDEO000001', { credentials: 'same-origin' });
  });

  it('refuses a watch page that belongs to another video', async () => {
    youtubeServer();
    runInjected();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(PAGES.VIDEO000002, { status: 200 })),
    );
    expect(await extractTab(4, CAPTIONED)).toEqual({
      ok: false,
      kind: 'youtube',
      reason: 'unreadable',
    });
  });

  it('fails as unreadable without a watch page, or with a malformed result', async () => {
    const spy = vi.spyOn(fakeBrowser.scripting, 'executeScript');
    for (const result of [
      undefined,
      null,
      'html',
      { language: 'en', html: 5, context: null },
      { html: '<html></html>', context: null },
      { language: 'en', html: null, context: null },
      { language: 'en', html: '<html>Consent</html>', context: null },
      { language: 'en', html: 'x'.repeat(16_000_001), context: null },
    ]) {
      spy.mockResolvedValueOnce([{ frameId: 0, documentId: 'd', result }] as Results);
      expect(await extractTab(4, CAPTIONED)).toEqual({
        ok: false,
        kind: 'youtube',
        reason: 'unreadable',
      });
    }
  });

  it('reports missing access and other script errors', async () => {
    const spy = vi.spyOn(fakeBrowser.scripting, 'executeScript');
    spy.mockRejectedValueOnce(new Error('Missing host permission for the tab'));
    expect(await extractTab(4, CAPTIONED)).toEqual({
      ok: false,
      kind: 'youtube',
      reason: 'no-access',
    });
    spy.mockRejectedValueOnce(new Error('No tab with id: 4.'));
    expect(await extractTab(4, CAPTIONED)).toEqual({
      ok: false,
      kind: 'youtube',
      reason: 'unreadable',
    });
  });

  it('caps a very long transcript and marks it truncated', async () => {
    const items = Array.from({ length: 3000 }, (_, i) => ({
      transcriptSegmentViewModel: {
        simpleText: `Synthetic segment ${String(i)} ${'word '.repeat(20)}`,
        timestamp: `${String(Math.floor(i / 60))}:${String(i % 60).padStart(2, '0')}`,
      },
    }));
    youtubeServer({ panel: JSON.stringify({ items }) });
    runInjected();
    const result = await extractTab(4, CAPTIONED);
    expect(result).toMatchObject({ ok: true, truncated: true, charCount: MAX_TEXT_CHARS });
  });

  it('never matches a URL without a video id', async () => {
    expect(youtubeExtractor.matches(new URL('https://www.youtube.com/'))).toBe(false);
    expect(await youtubeExtractor.extract(4, 'https://www.youtube.com/')).toEqual({
      ok: false,
      kind: 'youtube',
      reason: 'unreadable',
    });
  });
});

describe('dispatcher wiring', () => {
  it('runs the YouTube extractor before the generic page extractor', () => {
    expect(EXTRACTORS[0]).toBe(youtubeExtractor);
    expect(EXTRACTORS.at(-1)?.kind).toBe('page');
  });

  it.each([
    [CAPTIONED, 'youtube'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube'],
    ['https://www.youtube.com/', 'page'],
    ['https://www.youtube.com/results?search_query=x', 'page'],
    ['https://example.com/watch?v=dQw4w9WgXcQ', 'page'],
  ])('%s gets the %s badge', (url, kind) => {
    expect(detectKind(url)).toBe(kind);
  });
});
