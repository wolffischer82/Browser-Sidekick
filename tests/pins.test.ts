import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openRepository, type Repository } from '@/shared/db/repository';
import type { ExtractionResult } from '@/shared/extract';
import type { SidekickBroadcast } from '@/shared/messages';
import {
  findPinByUrl,
  normalizePinUrl,
  startPin,
  startRefresh,
  type PageRef,
  type PinDeps,
} from '@/shared/pins';

// Spec 5.4 pin status transitions and duplicates, spec 5.5 snapshot fields,
// D3 refresh, D11 first-pin fallback title.

let repo: Repository;
let clock: number;
let sent: SidekickBroadcast[];
let extract: ReturnType<typeof vi.fn<PinDeps['extract']>>;
let deps: PinDeps;

const ARTICLE: PageRef = {
  tabId: 7,
  url: 'https://example.com/news/trains#top',
  title: 'Night trains return',
  faviconUrl: 'https://example.com/favicon.ico',
};

const ok = (text = 'Body text', truncated = false): ExtractionResult => ({
  ok: true,
  kind: 'page',
  title: 'Extracted title',
  text,
  charCount: text.length,
  truncated,
});

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  clock = 1_000;
  repo = await openRepository({ now: () => (clock += 1) });
  sent = [];
  extract = vi.fn<PinDeps['extract']>().mockResolvedValue(ok());
  deps = {
    repo,
    extract,
    broadcast: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
    now: () => 5_000,
    browser: 'chrome',
  };
});

afterEach(() => {
  repo.close();
});

async function newSession(title = '', titleSource: 'fallback' | 'user' | 'llm' = 'fallback') {
  return repo.createSession({ providerId: null, model: null, title, titleSource });
}

describe('normalizePinUrl', () => {
  it.each([
    ['https://example.com/a#b', 'https://example.com/a'],
    ['https://example.com/a#', 'https://example.com/a'],
    ['https://example.com/a?x=1#y', 'https://example.com/a?x=1'],
    ['https://EXAMPLE.com/a', 'https://example.com/a'],
    ['https://example.com', 'https://example.com/'],
    ['not a url#frag', 'not a url'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePinUrl(input)).toBe(expected);
  });

  it('keeps the query and path case', () => {
    expect(normalizePinUrl('https://example.com/A?Q=1')).toBe('https://example.com/A?Q=1');
  });
});

describe('findPinByUrl', () => {
  it('matches without the fragment', async () => {
    const session = await newSession();
    const pin = await repo.addPin(session.id, {
      url: 'https://example.com/a#one',
      title: 'A',
      kind: 'page',
    });
    expect(findPinByUrl([pin], 'https://example.com/a#two')?.id).toBe(pin.id);
    expect(findPinByUrl([pin], 'https://example.com/b')).toBeUndefined();
  });
});

describe('startPin', () => {
  it('adds an extracting pin, then stores the snapshot and sets ready', async () => {
    const session = await newSession();
    let finish: (r: ExtractionResult) => void = () => undefined;
    extract.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const start = await startPin(deps, session.id, ARTICLE);
    expect(start.status).toBe('pinned');
    if (start.status !== 'pinned') return;
    expect(start.pin).toMatchObject({
      url: ARTICLE.url,
      title: ARTICLE.title,
      faviconUrl: ARTICLE.faviconUrl,
      kind: 'page',
      status: 'extracting',
    });
    expect(extract).toHaveBeenCalledWith(7, ARTICLE.url);
    expect(sent).toEqual([{ type: 'pins-changed', sessionId: session.id }]);

    finish(ok('Snapshot', true));
    await start.extraction;
    const stored = await repo.getPin(start.pin.id);
    expect(stored).toMatchObject({
      status: 'ready',
      text: 'Snapshot',
      charCount: 8,
      truncated: true,
      extractedAt: 5_000,
      failureReason: null,
      title: ARTICLE.title,
    });
    expect(sent).toHaveLength(2);
  });

  it('sets failed with the reason when extraction fails', async () => {
    const session = await newSession();
    extract.mockResolvedValue({ ok: false, kind: 'page', reason: 'empty' });
    const start = await startPin(deps, session.id, ARTICLE);
    if (start.status !== 'pinned') throw new Error('not pinned');
    await start.extraction;
    expect(await repo.getPin(start.pin.id)).toMatchObject({
      status: 'failed',
      failureReason: 'empty',
      text: '',
    });
    expect(sent.at(-1)).toEqual({ type: 'pins-changed', sessionId: session.id });
  });

  it('sets failed as unreadable when the extractor throws', async () => {
    const session = await newSession();
    extract.mockRejectedValue(new Error('boom'));
    const start = await startPin(deps, session.id, ARTICLE);
    if (start.status !== 'pinned') throw new Error('not pinned');
    await expect(start.extraction).resolves.toBeUndefined();
    expect(await repo.getPin(start.pin.id)).toMatchObject({
      status: 'failed',
      failureReason: 'unreadable',
    });
  });

  it('stores the kind the extractor reports', async () => {
    const session = await newSession();
    extract.mockResolvedValue({ ...ok(), kind: 'youtube' });
    const start = await startPin(deps, session.id, ARTICLE);
    if (start.status !== 'pinned') throw new Error('not pinned');
    await start.extraction;
    expect((await repo.getPin(start.pin.id))?.kind).toBe('youtube');
  });

  it('refuses a duplicate URL (fragment ignored) without adding or extracting', async () => {
    const session = await newSession();
    const first = await startPin(deps, session.id, ARTICLE);
    if (first.status !== 'pinned') throw new Error('not pinned');
    await first.extraction;
    extract.mockClear();
    sent = [];

    const again = await startPin(deps, session.id, {
      ...ARTICLE,
      url: 'https://example.com/news/trains#comments',
    });
    expect(again.status).toBe('duplicate');
    expect(again.status === 'duplicate' && again.pin.id).toBe(first.pin.id);
    expect(await repo.listPins(session.id)).toHaveLength(1);
    expect(extract).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('allows the same URL in another session', async () => {
    const a = await newSession();
    const b = await newSession();
    await startPin(deps, a.id, ARTICLE);
    const start = await startPin(deps, b.id, ARTICLE);
    expect(start.status).toBe('pinned');
  });

  it('refuses restricted pages without adding', async () => {
    const session = await newSession();
    for (const url of [
      'chrome://settings/',
      'https://chromewebstore.google.com/detail/x',
      'file:///tmp/a.html',
    ]) {
      expect(await startPin(deps, session.id, { ...ARTICLE, url })).toEqual({
        status: 'refused',
        reason: 'restricted',
      });
    }
    expect(await repo.listPins(session.id)).toEqual([]);
    expect(extract).not.toHaveBeenCalled();
  });

  it('refuses an unknown session', async () => {
    expect(await startPin(deps, 'missing', ARTICLE)).toEqual({
      status: 'refused',
      reason: 'not-found',
    });
  });

  it('uses the URL as title when the tab has none, then the extracted title', async () => {
    const session = await newSession();
    const start = await startPin(deps, session.id, { ...ARTICLE, title: '' });
    if (start.status !== 'pinned') throw new Error('not pinned');
    expect(start.pin.title).toBe(ARTICLE.url);
    await start.extraction;
    expect((await repo.getPin(start.pin.id))?.title).toBe('Extracted title');
  });

  it('does not overwrite a pin deleted during extraction', async () => {
    const session = await newSession();
    let finish: (r: ExtractionResult) => void = () => undefined;
    extract.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const start = await startPin(deps, session.id, ARTICLE);
    if (start.status !== 'pinned') throw new Error('not pinned');
    await repo.deletePin(start.pin.id);
    finish(ok());
    await start.extraction;
    expect(await repo.listPins(session.id)).toEqual([]);
  });

  describe('fallback title (D11)', () => {
    it('the first pin sets the fallback title', async () => {
      const session = await newSession();
      await startPin(deps, session.id, ARTICLE);
      expect(await repo.getSession(session.id)).toMatchObject({
        title: ARTICLE.title,
        titleSource: 'fallback',
      });
    });

    it('later pins keep it', async () => {
      const session = await newSession();
      await startPin(deps, session.id, ARTICLE);
      await startPin(deps, session.id, {
        ...ARTICLE,
        url: 'https://example.com/b',
        title: 'Second',
      });
      expect((await repo.getSession(session.id))?.title).toBe(ARTICLE.title);
    });

    it.each(['user', 'llm'] as const)('a %s title is never replaced', async (source) => {
      const session = await newSession('Kept', source);
      await startPin(deps, session.id, ARTICLE);
      expect(await repo.getSession(session.id)).toMatchObject({
        title: 'Kept',
        titleSource: source,
      });
    });

    it('a pin into an emptied session sets it again', async () => {
      const session = await newSession();
      const first = await startPin(deps, session.id, ARTICLE);
      if (first.status !== 'pinned') throw new Error('not pinned');
      await repo.deletePin(first.pin.id);
      await startPin(deps, session.id, {
        ...ARTICLE,
        url: 'https://example.com/b',
        title: 'Second',
      });
      expect((await repo.getSession(session.id))?.title).toBe('Second');
    });
  });
});

describe('startRefresh', () => {
  async function readyPin() {
    const session = await newSession();
    const start = await startPin(deps, session.id, ARTICLE);
    if (start.status !== 'pinned') throw new Error('not pinned');
    await start.extraction;
    sent = [];
    extract.mockClear();
    return { session, pin: start.pin };
  }

  it('sets extracting, re-extracts and stores the new snapshot', async () => {
    const { session, pin } = await readyPin();
    let finish: (r: ExtractionResult) => void = () => undefined;
    extract.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const refresh = await startRefresh(deps, pin.id, { ...ARTICLE, tabId: 9, title: 'Renamed' });
    expect(refresh.status).toBe('refreshing');
    if (refresh.status !== 'refreshing') return;
    expect(await repo.getPin(pin.id)).toMatchObject({ status: 'extracting', text: 'Body text' });
    expect(sent).toEqual([{ type: 'pins-changed', sessionId: session.id }]);
    expect(extract).toHaveBeenCalledWith(9, ARTICLE.url);

    finish(ok('Fresh text'));
    await refresh.extraction;
    expect(await repo.getPin(pin.id)).toMatchObject({
      status: 'ready',
      text: 'Fresh text',
      title: 'Renamed',
      failureReason: null,
    });
    expect(sent).toHaveLength(2);
  });

  it('marks the pin failed with the reason and keeps the previous snapshot', async () => {
    const { pin } = await readyPin();
    extract.mockResolvedValue({ ok: false, kind: 'page', reason: 'no-access' });
    const refresh = await startRefresh(deps, pin.id, ARTICLE);
    if (refresh.status !== 'refreshing') throw new Error('not refreshing');
    await refresh.extraction;
    expect(await repo.getPin(pin.id)).toMatchObject({
      status: 'failed',
      failureReason: 'no-access',
      text: 'Body text',
    });
  });

  it('refuses an unknown pin', async () => {
    expect(await startRefresh(deps, 'missing', ARTICLE)).toEqual({
      status: 'refused',
      reason: 'not-found',
    });
  });
});
