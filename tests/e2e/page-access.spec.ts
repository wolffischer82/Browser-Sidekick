import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from './fixture-server';
import {
  extensionId,
  hasPermission,
  launchWithExtension,
  launchWithGrantedOrigins,
  newProfile,
  openSidebarWindow,
  screens,
} from './extension';

// T06: the first-use access banner (shown, dismissible, remembered), the
// current tab without and with the all-sites grant, the tracker following
// tab and window switches, and the injected generic extractor. Fixture pages
// come from a local server. Screens: test-results/screens/T06-*.png.
// Page text is never written to test output: checks on it are booleans.

const ARTICLE_TITLE = 'Night trains return to Europe | The Fixture Times';
const DASHBOARD_TITLE = 'Fixture dashboard';

const banner = (page: Page) => page.getByRole('region', { name: 'Page access' });
const currentRow = (page: Page) => page.locator('.tab-rows .tab-row');

interface ChromeApi {
  windows: {
    create(o: object): Promise<{ id: number }>;
  };
  tabs: { query(o: object): Promise<{ id: number; url?: string }[]> };
  scripting: {
    executeScript(o: object): Promise<{ result?: unknown }[]>;
  };
}

test.describe('page access', () => {
  let server: FixtureServer;
  let context: BrowserContext | undefined;
  let removeProfile: (() => Promise<void>) | undefined;

  test.beforeEach(async () => {
    server = await startFixtureServer();
  });

  test.afterEach(async () => {
    await context?.close();
    await removeProfile?.();
    await server.close();
    context = undefined;
  });

  test('without access: banner shows, can be dismissed, the tab is not accessible', async () => {
    const profile = await newProfile();
    removeProfile = profile.remove;
    context = await launchWithExtension(profile.dir);
    const id = await extensionId(context);
    const tab = context.pages()[0] ?? (await context.newPage());
    await tab.goto(server.url('article.html'));

    const sidebar = await openSidebarWindow(context, id);
    expect(await hasPermission(sidebar, '<all_urls>')).toBe(false);
    await expect(banner(sidebar)).toBeVisible();
    await expect(banner(sidebar).getByRole('button', { name: 'Allow on all sites' })).toBeVisible();
    await expect(currentRow(sidebar)).toContainText('Current tab not accessible');
    await expect(currentRow(sidebar)).toContainText('right-click the page');
    await expect(sidebar.getByRole('button', { name: 'Session tabs (1)' })).toBeVisible();
    await screens(sidebar, 'T06-01-banner');

    // Without access the extractor can't run in the tab.
    const blocked = await sidebar.evaluate(async () => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      const [t] = await chrome.tabs.query({ active: true, windowType: 'normal' });
      try {
        await chrome.scripting.executeScript({
          target: { tabId: t?.id },
          files: ['/extract-page.js'],
        });
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked).toBe(true);

    // Dismiss: the banner goes and stays gone after reopening the sidebar.
    await sidebar.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner(sidebar)).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Session tabs (1)' })).toBeFocused();
    await screens(sidebar, 'T06-02-banner-dismissed');
    await sidebar.reload();
    await expect(currentRow(sidebar)).toContainText('Current tab not accessible');
    await expect(banner(sidebar)).toHaveCount(0);

    // Recovery: the row's link opens the Page access section in settings.
    await currentRow(sidebar).getByRole('button', { name: 'Allow on all sites' }).click();
    const section = sidebar.getByRole('region', { name: 'Page access' });
    await expect(section.getByRole('heading', { name: 'Page access' })).toBeFocused();
    await expect(section.getByText('Not allowed')).toBeVisible();
    await expect(section.getByRole('button', { name: 'Allow on all sites' })).toBeVisible();
    await screens(sidebar, 'T06-04-settings-page-access');
    await sidebar.getByRole('button', { name: 'Back' }).click();
    await expect(currentRow(sidebar)).toContainText('Current tab not accessible');
  });

  test('with access to all sites: the tracker follows tabs and windows', async () => {
    const profile = await newProfile();
    removeProfile = profile.remove;
    context = await launchWithGrantedOrigins(profile.dir, ['<all_urls>']);
    const id = await extensionId(context);
    const first = context.pages()[0] ?? (await context.newPage());
    await first.goto(server.url('article.html'));

    const sidebar = await openSidebarWindow(context, id);
    expect(await hasPermission(sidebar, '<all_urls>')).toBe(true);
    await expect(currentRow(sidebar)).toContainText(ARTICLE_TITLE);
    await expect(currentRow(sidebar)).toContainText('Current tab');
    await expect(currentRow(sidebar)).toContainText('127.0.0.1');
    await expect(banner(sidebar)).toHaveCount(0);
    await screens(sidebar, 'T06-03-granted');
    await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(
      sidebar.getByRole('region', { name: 'Page access' }).getByText('Allowed on all sites'),
    ).toBeVisible();
    await sidebar.getByRole('button', { name: 'Back' }).click();

    // A second tab in the same window.
    const second = await context.newPage();
    await second.goto(server.url('non-article.html'));
    await second.bringToFront();
    await expect(currentRow(sidebar)).toContainText(DASHBOARD_TITLE);
    await first.bringToFront();
    await expect(currentRow(sidebar)).toContainText(ARTICLE_TITLE);

    // Navigation in the current tab.
    await first.goto(server.url('non-article.html'));
    await expect(currentRow(sidebar)).toContainText(DASHBOARD_TITLE);
    await first.goto(server.url('article.html'));
    await expect(currentRow(sidebar)).toContainText(ARTICLE_TITLE);

    // A second window takes over; closing it returns to the first window.
    // (Headless Chromium doesn't move focus on `windows.update`, so going
    // back is driven by closing the window; unit tests cover focus events.)
    const [third] = await Promise.all([
      context.waitForEvent('page'),
      sidebar.evaluate(async (url) => {
        const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
        await chrome.windows.create({ url, type: 'normal', focused: true });
      }, server.url('non-article.html')),
    ]);
    await third.waitForLoadState();
    await expect(currentRow(sidebar)).toContainText(DASHBOARD_TITLE);
    await third.close();
    await expect(currentRow(sidebar)).toContainText(ARTICLE_TITLE);

    // The injected generic extractor reads the article.
    const extracted = await sidebar.evaluate(async (url) => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      const [t] = await chrome.tabs.query({ url });
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: t?.id },
        files: ['/extract-page.js'],
      });
      const p = r?.result as { title: string; text: string; truncated: boolean; method: string };
      return {
        method: p.method,
        title: p.title,
        truncated: p.truncated,
        hasArticle: p.text.includes('overnight rail services are coming back across Europe'),
        hasFooter: p.text.includes('FOOTER-SHOULD-NOT-APPEAR'),
      };
    }, server.url('article.html'));
    expect(extracted).toEqual({
      method: 'readability',
      title: 'Night trains return to Europe',
      truncated: false,
      hasArticle: true,
      hasFooter: false,
    });
  });
});
