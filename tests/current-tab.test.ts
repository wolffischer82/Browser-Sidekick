import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  classifyTab,
  readCurrentTab,
  watchCurrentTab,
  type CurrentTab,
  type TabInfo,
} from '@/shared/current-tab';
import { fakePermissions, type FakePermissions } from './helpers/permissions';

type Tabs = Awaited<ReturnType<typeof fakeBrowser.tabs.query>>;
type Win = Awaited<ReturnType<typeof fakeBrowser.windows.getLastFocused>>;

/**
 * A small model of the browser: windows with their active tab, the last
 * focused window, and what a tab reveals without the `tabs` permission
 * (URL and title only with host access to its site or all sites).
 */
interface FakeTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
}

let perms: FakePermissions;
let focused: number;
let active: Map<number, FakeTab>;
let getLastFocused: MockInstance<typeof fakeBrowser.windows.getLastFocused>;
let query: MockInstance<typeof fakeBrowser.tabs.query>;

function covered(url: string): boolean {
  if (perms.granted.has('<all_urls>')) return /^https?:/.test(url);
  const u = new URL(url);
  return perms.granted.has(`${u.protocol}//${u.hostname}/*`);
}

function reveal(tab: FakeTab): TabInfo {
  return covered(tab.url) ? tab : { id: tab.id, windowId: tab.windowId };
}

beforeEach(() => {
  fakeBrowser.reset();
  perms = fakePermissions([]);
  focused = 1;
  active = new Map([
    [1, { id: 11, windowId: 1, url: 'https://example.com/a', title: 'Example A' }],
    [2, { id: 21, windowId: 2, url: 'https://other.org/b', title: 'Other B' }],
  ]);
  getLastFocused = vi
    .spyOn(fakeBrowser.windows, 'getLastFocused')
    .mockImplementation(() => Promise.resolve({ id: focused } as Win));
  query = vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation(({ windowId }) => {
    const tab = windowId === undefined ? undefined : active.get(windowId);
    return Promise.resolve((tab ? [reveal(tab)] : []) as Tabs);
  });
});

describe('classifyTab', () => {
  const ids = { id: 5, windowId: 2 };
  const none = { allSites: false, site: false };

  it.each<[string, TabInfo | undefined, { allSites: boolean; site: boolean }, CurrentTab]>([
    ['no tab', undefined, none, { state: 'none' }],
    ['a tab without an id', { windowId: 2 }, none, { state: 'none' }],
    ['hidden URL without all sites', ids, none, { state: 'noAccess', tabId: 5, windowId: 2 }],
    [
      'hidden URL with all sites (a browser page)',
      ids,
      { allSites: true, site: true },
      { state: 'restricted', tabId: 5, windowId: 2, url: null, title: null },
    ],
    [
      'a visible restricted URL',
      { ...ids, url: 'https://chromewebstore.google.com/x', title: 'Store' },
      { allSites: true, site: true },
      {
        state: 'restricted',
        tabId: 5,
        windowId: 2,
        url: 'https://chromewebstore.google.com/x',
        title: 'Store',
      },
    ],
    [
      'a URL visible through activeTab only',
      { ...ids, url: 'https://a.example/', title: 'A', favIconUrl: 'https://a.example/f.ico' },
      none,
      {
        state: 'readable',
        tabId: 5,
        windowId: 2,
        url: 'https://a.example/',
        title: 'A',
        faviconUrl: 'https://a.example/f.ico',
        siteAccess: false,
      },
    ],
    [
      'a site grant',
      { ...ids, url: 'https://a.example/' },
      { allSites: false, site: true },
      {
        state: 'readable',
        tabId: 5,
        windowId: 2,
        url: 'https://a.example/',
        title: 'https://a.example/',
        faviconUrl: null,
        siteAccess: true,
      },
    ],
  ])('%s', (_name, tab, access, expected) => {
    expect(classifyTab(tab, access, 'chrome')).toEqual(expected);
  });

  it('uses the restricted list of the running browser', () => {
    const tab = { ...ids, url: 'https://addons.mozilla.org/', title: 'AMO' };
    const access = { allSites: true, site: true };
    expect(classifyTab(tab, access, 'firefox').state).toBe('restricted');
    expect(classifyTab(tab, access, 'chrome').state).toBe('readable');
  });
});

describe('readCurrentTab', () => {
  it('reads the active tab of the last focused normal window', async () => {
    perms.granted.add('<all_urls>');
    expect(await readCurrentTab()).toMatchObject({
      state: 'readable',
      tabId: 11,
      title: 'Example A',
      siteAccess: true,
    });
    expect(getLastFocused).toHaveBeenCalledWith({ windowTypes: ['normal'] });
    expect(query).toHaveBeenCalledWith({ active: true, windowId: 1 });
  });

  it('reports a tab as not accessible without access', async () => {
    expect(await readCurrentTab()).toEqual({ state: 'noAccess', tabId: 11, windowId: 1 });
  });

  it('sees a site grant', async () => {
    perms.granted.add('https://example.com/*');
    expect(await readCurrentTab()).toMatchObject({ state: 'readable', siteAccess: true });
  });

  it('reports no tab when there is no window', async () => {
    getLastFocused.mockRejectedValue(new Error('No window'));
    expect(await readCurrentTab()).toEqual({ state: 'none' });
  });
});

describe('watchCurrentTab', () => {
  async function watch() {
    const seen: CurrentTab[] = [];
    const stop = watchCurrentTab((tab) => seen.push(tab));
    await vi.waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    return { seen, stop };
  }
  const titles = (seen: CurrentTab[]) =>
    seen.map((s) => (s.state === 'readable' ? s.title : s.state));

  it('follows tab switches, navigation and window focus', async () => {
    perms.granted.add('<all_urls>');
    const { seen, stop } = await watch();

    active.set(1, { id: 12, windowId: 1, url: 'https://example.com/c', title: 'Example C' });
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 12, windowId: 1 });
    await vi.waitFor(() => {
      expect(seen).toHaveLength(2);
    });

    active.set(1, { id: 12, windowId: 1, url: 'https://example.com/d', title: 'Example D' });
    await fakeBrowser.tabs.onUpdated.trigger(12, { status: 'complete' }, {} as never);
    await vi.waitFor(() => {
      expect(seen).toHaveLength(3);
    });

    focused = 2;
    await fakeBrowser.windows.onFocusChanged.trigger(2);
    await vi.waitFor(() => {
      expect(seen).toHaveLength(4);
    });
    expect(titles(seen)).toEqual(['Example A', 'Example C', 'Example D', 'Other B']);
    stop();
  });

  it('ignores focus leaving the browser and other tabs updating', async () => {
    const { seen, stop } = await watch();
    const queries = query.mock.calls.length;
    focused = 2;
    await fakeBrowser.windows.onFocusChanged.trigger(-1);
    await fakeBrowser.tabs.onUpdated.trigger(99, { title: 'x' }, {} as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(query.mock.calls.length).toBe(queries);
    expect(seen).toHaveLength(1);
    stop();
  });

  it('updates when access is granted or revoked', async () => {
    const { seen, stop } = await watch();
    expect(seen[0]).toMatchObject({ state: 'noAccess' });
    perms.grant('<all_urls>');
    await vi.waitFor(() => {
      expect(seen).toHaveLength(2);
    });
    expect(seen[1]).toMatchObject({ state: 'readable', title: 'Example A' });
    perms.revoke('<all_urls>');
    await vi.waitFor(() => {
      expect(seen).toHaveLength(3);
    });
    expect(seen[2]).toMatchObject({ state: 'noAccess' });
    stop();
  });

  it('reports nothing when the tab did not change', async () => {
    const { seen, stop } = await watch();
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 11, windowId: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toHaveLength(1);
    stop();
  });

  it('drops a stale answer that arrives after a newer one', async () => {
    perms.granted.add('<all_urls>');
    const { seen, stop } = await watch();
    let release: () => void = () => undefined;
    const slow = new Promise<void>((r) => (release = r));
    getLastFocused.mockImplementationOnce(async () => {
      await slow;
      return { id: 2 } as Win;
    });
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 21, windowId: 2 });
    active.set(1, { id: 13, windowId: 1, url: 'https://example.com/e', title: 'Example E' });
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 13, windowId: 1 });
    await vi.waitFor(() => {
      expect(seen).toHaveLength(2);
    });
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(titles(seen)).toEqual(['Example A', 'Example E']);
    stop();
  });

  it('stops listening', async () => {
    const { seen, stop } = await watch();
    stop();
    active.set(1, { id: 14, windowId: 1, url: 'https://example.com/f', title: 'F' });
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 14, windowId: 1 });
    perms.grant('<all_urls>');
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toHaveLength(1);
  });
});
