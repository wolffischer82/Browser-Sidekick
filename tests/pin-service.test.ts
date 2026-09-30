import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { openRepository, type Repository } from '@/shared/db/repository';
import type { ExtractionResult } from '@/shared/extract';
import type { SidekickBroadcast } from '@/shared/messages';
import {
  PIN_MENU_ID,
  handleMenuClick,
  handleRequest,
  onRequestMessage,
  pinMenuContexts,
  registerPinMenu,
  startPinService,
  type ServiceDeps,
} from '@/shared/pin-service';
import { getSettings, updateSettings } from '@/shared/settings';
import { useLocale } from './helpers/i18n';

// Spec 5.4: the "Pin to Sidekick" context menu (Chrome page/frame, Firefox
// also the tab strip), pinning into the active session with no sidebar open,
// and the sidebar's pin and refresh requests.

type Tab = Browser.tabs.Tab;

let repo: Repository;
let sent: SidekickBroadcast[];
let extract: ReturnType<typeof vi.fn<ServiceDeps['extract']>>;
let deps: ServiceDeps;
let tabs: Tab[];

const ARTICLE = {
  id: 7,
  windowId: 1,
  url: 'https://example.com/article',
  title: 'Night trains',
  favIconUrl: 'https://example.com/favicon.ico',
  active: true,
} as Tab;

const ready: ExtractionResult = {
  ok: true,
  kind: 'page',
  title: 'Night trains',
  text: 'Text',
  charCount: 4,
  truncated: false,
};

beforeEach(async () => {
  fakeBrowser.reset();
  useLocale('en');
  globalThis.indexedDB = new IDBFactory();
  repo = await openRepository();
  sent = [];
  extract = vi.fn<ServiceDeps['extract']>().mockResolvedValue(ready);
  deps = {
    repo: () => Promise.resolve(repo),
    extract,
    broadcast: (m) => {
      sent.push(m);
      return Promise.resolve();
    },
    browser: 'chrome',
  };
  tabs = [ARTICLE];
  vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation((id) => {
    const tab = tabs.find((t) => t.id === id);
    return tab ? Promise.resolve(tab as never) : Promise.reject(new Error('No tab'));
  });
  vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation(() => Promise.resolve(tabs as never));
});

afterEach(() => {
  repo.close();
});

/** Waits until every pin of the session has left `extracting`. */
async function settled(sessionId: string) {
  await vi.waitFor(async () => {
    const pins = await repo.listPins(sessionId);
    expect(pins.every((p) => p.status !== 'extracting')).toBe(true);
  });
  return repo.listPins(sessionId);
}

describe('menu item', () => {
  it('uses page and frame in Chrome, and adds the tab strip in Firefox', () => {
    expect(pinMenuContexts(false)).toEqual(['page', 'frame']);
    expect(pinMenuContexts(true)).toEqual(['page', 'frame', 'tab']);
  });

  it.each([
    [false, ['page', 'frame']],
    [true, ['page', 'frame', 'tab']],
  ])('registers "Pin to Sidekick" (firefox: %s)', async (isFirefox, contexts) => {
    const removeAll = vi.spyOn(fakeBrowser.contextMenus, 'removeAll').mockResolvedValue();
    const create = vi.spyOn(fakeBrowser.contextMenus, 'create').mockReturnValue(PIN_MENU_ID);
    await registerPinMenu(isFirefox);
    expect(removeAll).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({ id: PIN_MENU_ID, title: 'Pin to Sidekick', contexts });
  });

  it('is titled in German', async () => {
    useLocale('de');
    vi.spyOn(fakeBrowser.contextMenus, 'removeAll').mockResolvedValue();
    const create = vi.spyOn(fakeBrowser.contextMenus, 'create').mockReturnValue(PIN_MENU_ID);
    await registerPinMenu(false);
    expect(create.mock.calls[0]?.[0].title).toBe('An Sidekick anheften');
  });
});

describe('handleMenuClick', () => {
  it('pins into the active session and extracts', async () => {
    const session = await repo.createSession({ providerId: null, model: null });
    await updateSettings({ activeSessionId: session.id });
    const start = await handleMenuClick(deps, { menuItemId: PIN_MENU_ID }, ARTICLE);
    expect(start?.status).toBe('pinned');
    const [pin] = await settled(session.id);
    expect(pin).toMatchObject({ url: ARTICLE.url, title: 'Night trains', status: 'ready' });
    expect(extract).toHaveBeenCalledWith(7, ARTICLE.url);
    expect(sent).toContainEqual({ type: 'pins-changed', sessionId: session.id });
  });

  it('creates and activates a session when none exists (sidebar never opened)', async () => {
    await handleMenuClick(deps, { menuItemId: PIN_MENU_ID }, ARTICLE);
    const { activeSessionId } = await getSettings();
    expect(activeSessionId).toBeTruthy();
    const pins = await settled(activeSessionId ?? '');
    expect(pins).toHaveLength(1);
    expect((await repo.getSession(activeSessionId ?? ''))?.title).toBe('Night trains');
  });

  it('pins a tab-strip tab that is not the active tab (Firefox)', async () => {
    const other = { ...ARTICLE, id: 9, active: false, url: 'https://example.org/b' } as Tab;
    await handleMenuClick(deps, { menuItemId: PIN_MENU_ID }, other);
    expect(extract).toHaveBeenCalledWith(9, 'https://example.org/b');
  });

  it('falls back to the page URL when the tab has none', async () => {
    const start = await handleMenuClick(
      deps,
      { menuItemId: PIN_MENU_ID, pageUrl: 'https://example.com/p' },
      { ...ARTICLE, url: undefined },
    );
    expect(start?.status === 'pinned' && start.pin.url).toBe('https://example.com/p');
  });

  it('announces a duplicate to open sidebars', async () => {
    const first = await handleMenuClick(deps, { menuItemId: PIN_MENU_ID }, ARTICLE);
    if (first?.status !== 'pinned') throw new Error('not pinned');
    await first.extraction;
    sent = [];
    const again = await handleMenuClick(
      deps,
      { menuItemId: PIN_MENU_ID },
      {
        ...ARTICLE,
        url: `${ARTICLE.url ?? ''}#section`,
      },
    );
    expect(again?.status).toBe('duplicate');
    expect(sent).toEqual([
      { type: 'already-pinned', sessionId: first.pin.sessionId, pinId: first.pin.id },
    ]);
  });

  it('ignores other menu items and tabs without a visible URL', async () => {
    expect(await handleMenuClick(deps, { menuItemId: 'other' }, ARTICLE)).toBeNull();
    expect(
      await handleMenuClick(
        deps,
        { menuItemId: PIN_MENU_ID },
        {
          ...ARTICLE,
          url: undefined,
        },
      ),
    ).toBeNull();
    expect(await handleMenuClick(deps, { menuItemId: PIN_MENU_ID }, undefined)).toBeNull();
    expect(extract).not.toHaveBeenCalled();
  });

  it('refuses a restricted page', async () => {
    const start = await handleMenuClick(
      deps,
      { menuItemId: PIN_MENU_ID },
      {
        ...ARTICLE,
        url: 'https://chromewebstore.google.com/detail/x',
      },
    );
    expect(start).toEqual({ status: 'refused', reason: 'restricted' });
  });
});

describe('handleRequest', () => {
  it('pin-tab pins the tab into the given session and answers while extracting', async () => {
    const session = await repo.createSession({ providerId: null, model: null });
    let finish: (r: ExtractionResult) => void = () => undefined;
    extract.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const outcome = await handleRequest(deps, {
      type: 'pin-tab',
      sessionId: session.id,
      tabId: 7,
    });
    expect(outcome.status).toBe('pinned');
    expect((await repo.listPins(session.id))[0]?.status).toBe('extracting');
    finish(ready);
    expect((await settled(session.id))[0]?.status).toBe('ready');
  });

  it('pin-tab answers duplicate, and refuses closed or hidden tabs', async () => {
    const session = await repo.createSession({ providerId: null, model: null });
    const req = { type: 'pin-tab', sessionId: session.id, tabId: 7 } as const;
    const first = await handleRequest(deps, req);
    expect(await handleRequest(deps, req)).toEqual({
      status: 'duplicate',
      pinId: first.status === 'pinned' ? first.pinId : '',
    });
    expect(await handleRequest(deps, { ...req, tabId: 99 })).toEqual({
      status: 'refused',
      reason: 'not-open',
    });
    tabs = [{ ...ARTICLE, url: undefined }];
    expect(await handleRequest(deps, req)).toEqual({ status: 'refused', reason: 'no-access' });
  });

  it('refresh-pin re-extracts from the open tab', async () => {
    const session = await repo.createSession({ providerId: null, model: null });
    await handleRequest(deps, { type: 'pin-tab', sessionId: session.id, tabId: 7 });
    const [pin] = await settled(session.id);
    extract.mockClear();
    extract.mockResolvedValue({ ...ready, text: 'Fresh' });
    tabs = [{ ...ARTICLE, id: 12, url: `${ARTICLE.url ?? ''}#x` }];

    const outcome = await handleRequest(deps, { type: 'refresh-pin', pinId: pin?.id ?? '' });
    expect(outcome).toEqual({ status: 'refreshing', pinId: pin?.id });
    expect(extract).toHaveBeenCalledWith(12, ARTICLE.url);
    await vi.waitFor(async () => {
      expect((await repo.getPin(pin?.id ?? ''))?.text).toBe('Fresh');
    });
  });

  it('refresh-pin refuses a closed tab or an unknown pin', async () => {
    const session = await repo.createSession({ providerId: null, model: null });
    await handleRequest(deps, { type: 'pin-tab', sessionId: session.id, tabId: 7 });
    const [pin] = await settled(session.id);
    tabs = [];
    expect(await handleRequest(deps, { type: 'refresh-pin', pinId: pin?.id ?? '' })).toEqual({
      status: 'refused',
      reason: 'not-open',
    });
    expect(await handleRequest(deps, { type: 'refresh-pin', pinId: 'nope' })).toEqual({
      status: 'refused',
      reason: 'not-found',
    });
  });
});

describe('onRequestMessage', () => {
  it('answers requests through sendResponse and keeps the channel open', async () => {
    const session = await repo.createSession({ providerId: null, model: null });
    const sendResponse = vi.fn();
    const keep = onRequestMessage(
      deps,
      { type: 'pin-tab', sessionId: session.id, tabId: 7 },
      sendResponse,
    );
    expect(keep).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 'pinned' }));
    });
  });

  it.each([
    { type: 'pins-changed', sessionId: 's' },
    { type: 'already-pinned', sessionId: 's', pinId: 'p' },
    { type: 'pin-tab', tabId: 'x' },
    'hello',
    null,
  ])('leaves %j alone', (message) => {
    const sendResponse = vi.fn();
    expect(onRequestMessage(deps, message, sendResponse)).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('answers not-found when the request fails', async () => {
    const failing = { ...deps, repo: () => Promise.reject(new Error('db')) };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sendResponse = vi.fn();
    onRequestMessage(failing, { type: 'refresh-pin', pinId: 'p' }, sendResponse);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ status: 'refused', reason: 'not-found' });
    });
    expect(error).toHaveBeenCalledWith('Sidekick: a pin request failed.');
  });
});

describe('startPinService', () => {
  it('creates the menu on install and pins on click', async () => {
    let onClicked: ((info: { menuItemId: string }, tab?: Tab) => void) | undefined;
    vi.spyOn(fakeBrowser.contextMenus.onClicked, 'addListener').mockImplementation((l) => {
      onClicked = l as typeof onClicked;
    });
    vi.spyOn(fakeBrowser.contextMenus, 'removeAll').mockResolvedValue();
    const create = vi.spyOn(fakeBrowser.contextMenus, 'create').mockReturnValue(PIN_MENU_ID);
    startPinService(true, deps);

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install', temporary: false });
    await vi.waitFor(() => {
      expect(create).toHaveBeenCalledOnce();
    });
    expect(create.mock.calls[0]?.[0].contexts).toEqual(['page', 'frame', 'tab']);

    onClicked?.({ menuItemId: PIN_MENU_ID }, ARTICLE);
    await vi.waitFor(async () => {
      const { activeSessionId } = await getSettings();
      expect(await repo.listPins(activeSessionId ?? '')).toHaveLength(1);
    });
  });
});
