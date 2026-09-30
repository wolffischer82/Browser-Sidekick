import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { App } from '@/entrypoints/sidepanel/App';
import type { Repository } from '@/shared/db/repository';
import { getSettings, updateSettings } from '@/shared/settings';
import { readMessages, type Locale } from './helpers/i18n';
import { NATIVE_HOSTS, fakePermissions, type FakePermissions } from './helpers/permissions';
import { freshRepository, renderSidebar } from './helpers/sidebar';

// Spec 5.3: the first-use access banner, and the current-tab row that the
// tracker feeds (spec 5.2 item 3).

type Tabs = Awaited<ReturnType<typeof fakeBrowser.tabs.query>>;
type Win = Awaited<ReturnType<typeof fakeBrowser.windows.getLastFocused>>;

const TEXT = readMessages('en');
const msg = (key: string) => TEXT[key]?.message ?? '';
const ALLOW = 'Allow on all sites';

let repo: Repository | undefined;
let perms: FakePermissions;
let tab: { id: number; windowId: number; url: string; title: string };

/** The browser shows URL and title only with access to the tab's site. */
function mockTabs(): void {
  vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockImplementation(() =>
    Promise.resolve({ id: tab.windowId } as Win),
  );
  vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation(() => {
    const visible = perms.granted.has('<all_urls>') && tab.url.startsWith('http');
    return Promise.resolve([visible ? tab : { id: tab.id, windowId: tab.windowId }] as Tabs);
  });
}

async function open(locale: Locale = 'en', granted: string[] = NATIVE_HOSTS): Promise<void> {
  repo = await freshRepository(locale);
  perms = fakePermissions(granted);
  mockTabs();
  if (locale === 'en') await renderSidebar(repo);
  else render(<App repository={Promise.resolve(repo)} />);
}

const banner = () => screen.queryByRole('region', { name: 'Page access' });

beforeEach(() => {
  tab = { id: 11, windowId: 1, url: 'https://example.com/news/a', title: 'Night trains' };
});

afterEach(() => {
  cleanup();
  repo?.close();
});

describe('access banner', () => {
  it('explains why and offers access to all sites on first open', async () => {
    await open();
    await screen.findByRole('region', { name: 'Page access' });
    expect(banner()?.textContent).toContain(msg('accessBannerText'));
    expect(screen.getByRole('button', { name: ALLOW })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('renders in German', async () => {
    await open('de');
    const de = readMessages('de');
    await screen.findByRole('region', { name: de.accessBannerLabel?.message ?? '' });
    expect(screen.getByRole('button', { name: 'Auf allen Websites erlauben' })).toBeTruthy();
    expect(screen.getByText(de.accessBannerText?.message ?? '')).toBeTruthy();
  });

  it('requests <all_urls> from the click and goes away when granted', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: ALLOW }));
    // Synchronously inside the click, before any await (Firefox).
    expect(perms.requests).toEqual([['<all_urls>']]);
    await waitFor(() => {
      expect(banner()).toBeNull();
    });
    expect((await getSettings()).accessBannerDismissed).toBe(false);
    await waitFor(() => {
      expect(document.activeElement?.className).toBe('session-tabs-toggle');
    });
  });

  it.each(['decline', 'throw'] as const)(
    'counts a %s answer as the one ask and hides for good',
    async (answer) => {
      await open();
      perms.answer = answer;
      fireEvent.click(await screen.findByRole('button', { name: ALLOW }));
      expect(perms.requests).toHaveLength(1);
      await waitFor(() => {
        expect(banner()).toBeNull();
      });
      await waitFor(async () => {
        expect((await getSettings()).accessBannerDismissed).toBe(true);
      });
    },
  );

  it('can be dismissed, and stays dismissed on the next open', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(banner()).toBeNull();
    expect(perms.requests).toEqual([]);
    await waitFor(async () => {
      expect((await getSettings()).accessBannerDismissed).toBe(true);
    });
    cleanup();
    render(<App repository={Promise.resolve(repo as Repository)} />);
    await screen.findByTitle('Rename session');
    await new Promise((r) => setTimeout(r, 20));
    expect(banner()).toBeNull();
  });

  it('is keyboard-operable', async () => {
    await open();
    const allow = await screen.findByRole('button', { name: ALLOW });
    allow.focus();
    expect(document.activeElement).toBe(allow);
    expect(allow.tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: 'Dismiss' }).tagName).toBe('BUTTON');
  });

  it('does not show when access to all sites is held', async () => {
    await open('en', [...NATIVE_HOSTS, '<all_urls>']);
    await screen.findByText('Night trains');
    expect(banner()).toBeNull();
  });

  it('follows grants and revocations made outside the sidebar', async () => {
    await open();
    await screen.findByRole('region', { name: 'Page access' });
    perms.grant('<all_urls>');
    await waitFor(() => {
      expect(banner()).toBeNull();
    });
    perms.revoke('<all_urls>');
    await screen.findByRole('region', { name: 'Page access' });
  });

  it('hides when dismissed from another sidebar', async () => {
    await open();
    await updateSettings({ accessBannerDismissed: true });
    await waitFor(() => {
      expect(banner()).toBeNull();
    });
  });
});

describe('current-tab row', () => {
  const heading = (n: number) => msg('sessionTabsHeading').replace('$COUNT$', String(n));

  it('says the current tab is not accessible without access', async () => {
    await open();
    await screen.findByText('Current tab not accessible');
    expect(screen.queryByText('Night trains')).toBeNull();
    expect(screen.getByRole('button', { name: heading(1) })).toBeTruthy();
  });

  it('shows title, domain and the marker once access is granted', async () => {
    await open();
    await screen.findByText('Current tab not accessible');
    perms.grant('<all_urls>');
    await screen.findByText('Night trains');
    expect(screen.getByText('example.com')).toBeTruthy();
    expect(screen.getByText('Current tab')).toBeTruthy();
    expect(screen.queryByText('Current tab not accessible')).toBeNull();
  });

  it('follows tab switches', async () => {
    await open('en', [...NATIVE_HOSTS, '<all_urls>']);
    await screen.findByText('Night trains');
    tab = { id: 12, windowId: 1, url: 'https://other.org/b', title: 'Sleeper cars' };
    await fakeBrowser.tabs.onActivated.trigger({ tabId: 12, windowId: 1 });
    await screen.findByText('Sleeper cars');
    expect(screen.getByText('other.org')).toBeTruthy();
    expect(screen.queryByText('Night trains')).toBeNull();
  });

  it('says a restricted page cannot be read', async () => {
    tab = { id: 13, windowId: 1, url: 'chrome://settings/', title: 'Settings' };
    await open('en', [...NATIVE_HOSTS, '<all_urls>']);
    await screen.findByText("This page can't be read");
    expect(screen.getByText('Current tab')).toBeTruthy();
  });

  it('shows no row when there is no browser window', async () => {
    repo = await freshRepository();
    perms = fakePermissions();
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockRejectedValue(new Error('none'));
    await renderSidebar(repo);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Current tab not accessible')).toBeNull();
    expect(screen.getByRole('button', { name: heading(0) })).toBeTruthy();
  });

  it('hides the row with the section', async () => {
    await open();
    await screen.findByText('Current tab not accessible');
    fireEvent.click(screen.getByRole('button', { name: heading(1) }));
    expect(screen.getByText('Current tab not accessible').closest('[hidden]')).not.toBeNull();
  });
});
