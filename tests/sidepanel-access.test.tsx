import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
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
/** The banner's button; the current-tab row has a link with the same name. */
async function bannerButton(name: string, region = 'Page access'): Promise<HTMLElement> {
  return within(await screen.findByRole('region', { name: region })).getByRole('button', { name });
}

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
    expect(await bannerButton(ALLOW)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('is a card with the shield tile, a primary Allow and a plain Dismiss (redesign spec 5.5)', async () => {
    await open();
    const region = await screen.findByRole('region', { name: 'Page access' });
    const tile = region.querySelector('.access-banner-tile');
    expect(tile?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(region.firstElementChild).toBe(tile);
    expect((await bannerButton(ALLOW)).className).toContain('button-primary');
    expect(within(region).getByRole('button', { name: 'Dismiss' }).className).toContain(
      'button-plain',
    );
  });

  it('renders in German', async () => {
    await open('de');
    const de = readMessages('de');
    await screen.findByRole('region', { name: de.accessBannerLabel?.message ?? '' });
    expect(
      await bannerButton('Auf allen Websites erlauben', de.accessBannerLabel?.message),
    ).toBeTruthy();
    expect(screen.getByText(de.accessBannerText?.message ?? '')).toBeTruthy();
  });

  it('requests <all_urls> from the click and goes away when granted', async () => {
    await open();
    fireEvent.click(await bannerButton(ALLOW));
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
      fireEvent.click(await bannerButton(ALLOW));
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
    const allow = await bannerButton(ALLOW);
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
  const heading = (n: number) => `${msg('sessionTabsLabel')} ${String(n)}`;

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

describe('page access in settings', () => {
  const section = () => screen.getByRole('region', { name: 'Page access' });

  it('opens from the not-accessible row, focused, and asks for all sites from the click', async () => {
    await open();
    await screen.findByText('Current tab not accessible');
    expect(screen.getByText(msg('currentTabNoAccessHint'))).toBeTruthy();
    const link = document.getElementById('page-access-link');
    expect(link?.textContent).toBe(ALLOW);
    fireEvent.click(link as HTMLElement);

    const heading = await screen.findByRole('heading', { name: 'Page access' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    await within(section()).findByText('Not allowed');
    fireEvent.click(within(section()).getByRole('button', { name: ALLOW }));
    expect(perms.requests).toEqual([['<all_urls>']]);
    await within(section()).findByText('Allowed on all sites');
    expect(within(section()).queryByRole('button', { name: ALLOW })).toBeNull();

    // Back in the session, the current tab is now readable.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('Night trains');
  });

  it('keeps offering the request when declined', async () => {
    await open();
    await updateSettings({ accessBannerDismissed: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    await within(section()).findByText('Not allowed');
    perms.answer = 'decline';
    fireEvent.click(within(section()).getByRole('button', { name: ALLOW }));
    expect(perms.requests).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(within(section()).getByText('Not allowed')).toBeTruthy();
    expect(within(section()).getByRole('button', { name: ALLOW })).toBeTruthy();
  });

  it('shows the grant, sits above Delete all data, and keeps focus on Back from the gear', async () => {
    await open('en', [...NATIVE_HOSTS, '<all_urls>']);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    await within(section()).findByText('Allowed on all sites');
    expect(within(section()).queryByRole('button')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back' }));
    const deleteAll = screen.getByRole('heading', { name: msg('deleteAllHeading') });
    expect(
      section().compareDocumentPosition(deleteAll) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('follows a grant made outside the sidebar', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    await within(section()).findByText('Not allowed');
    perms.grant('<all_urls>');
    await within(section()).findByText('Allowed on all sites');
  });

  it('renders the row hint and the section in German', async () => {
    await open('de');
    const de = readMessages('de');
    await screen.findByText(de.currentTabNoAccessHint?.message ?? '');
    fireEvent.click(document.getElementById('page-access-link') as HTMLElement);
    await screen.findByText(de.pageAccessText?.message ?? '');
    await screen.findByText('Nicht erlaubt');
  });
});
