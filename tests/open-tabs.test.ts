import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  findTab,
  focusOrOpen,
  listOpenTabs,
  watchOpenTabs,
  type OpenTab,
} from '@/shared/open-tabs';
import { fakePermissions, type FakePermissions } from './helpers/permissions';

// Open tabs by URL for Open and Refresh (spec 5.2, D3). Without `tabs`, a tab
// without host access shows no URL and so never counts as open.

type Tabs = Awaited<ReturnType<typeof fakeBrowser.tabs.query>>;

let tabs: Tabs;
let perms: FakePermissions;

beforeEach(() => {
  fakeBrowser.reset();
  perms = fakePermissions([]);
  tabs = [
    { id: 1, windowId: 10, url: 'https://example.com/a#x', active: false },
    { id: 2, windowId: 20, url: 'https://example.com/a', active: true },
    { id: 3, windowId: 10, active: true },
    { id: 4, windowId: 10, url: 'https://other.org/', active: false },
  ] as Tabs;
  vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation(() => Promise.resolve(tabs));
});

describe('listOpenTabs', () => {
  it('lists only tabs with a visible URL', async () => {
    expect((await listOpenTabs()).map((t) => t.tabId)).toEqual([1, 2, 4]);
  });

  it('returns nothing when the query fails', async () => {
    vi.spyOn(fakeBrowser.tabs, 'query').mockRejectedValue(new Error('x'));
    expect(await listOpenTabs()).toEqual([]);
  });
});

describe('findTab', () => {
  const open: OpenTab[] = [
    { tabId: 1, windowId: 10, url: 'https://example.com/a#x', active: false },
    { tabId: 2, windowId: 20, url: 'https://example.com/a', active: true },
  ];

  it('matches without the fragment and prefers an active tab', () => {
    expect(findTab(open, 'https://example.com/a#y')?.tabId).toBe(2);
    expect(findTab(open.slice(0, 1), 'https://example.com/a')?.tabId).toBe(1);
    expect(findTab(open, 'https://example.com/b')).toBeUndefined();
  });
});

describe('focusOrOpen', () => {
  it('focuses an open tab and its window', async () => {
    const update = vi.spyOn(fakeBrowser.tabs, 'update').mockResolvedValue({} as never);
    const focus = vi.spyOn(fakeBrowser.windows, 'update').mockResolvedValue({} as never);
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    await focusOrOpen('https://other.org/');
    expect(update).toHaveBeenCalledWith(4, { active: true });
    expect(focus).toHaveBeenCalledWith(10, { focused: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('opens a new tab otherwise', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never);
    await focusOrOpen('https://closed.example/page');
    expect(create).toHaveBeenCalledWith({ url: 'https://closed.example/page' });
  });

  it('never opens a non-web URL', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create');
    await focusOrOpen('javascript:alert(1)');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('watchOpenTabs', () => {
  const anyTab = { id: 2, windowId: 20, active: true } as Tabs[number];
  it('reports now and after tab events and access changes', async () => {
    const listener = vi.fn();
    const stop = watchOpenTabs(listener);
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(1);
    });

    tabs = tabs.filter((t) => t.id !== 1);
    await fakeBrowser.tabs.onRemoved.trigger(1, { windowId: 10, isWindowClosing: false });
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(2);
    });
    expect((listener.mock.lastCall?.[0] as OpenTab[]).map((t) => t.tabId)).toEqual([2, 4]);

    // A title change alone doesn't matter; a URL change does.
    await fakeBrowser.tabs.onUpdated.trigger(2, { title: 'x' }, anyTab);
    await fakeBrowser.tabs.onUpdated.trigger(2, { url: 'https://example.com/c' }, anyTab);
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(3);
    });

    perms.grant('<all_urls>');
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(4);
    });

    stop();
    await fakeBrowser.tabs.onCreated.trigger(anyTab);
    await new Promise((r) => setTimeout(r, 10));
    expect(listener).toHaveBeenCalledTimes(4);
  });
});
