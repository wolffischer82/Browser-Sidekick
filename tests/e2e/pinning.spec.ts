import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from './fixture-server';
import {
  extensionId,
  launchWithGrantedOrigins,
  newProfile,
  openSidebarWindow,
  screen,
  screens,
} from './extension';

// T07: pinning from the current-tab needle (extracting -> ready, failed),
// duplicates refused with "Already pinned", refresh, unpin, the eye toggle,
// the collapsed section, and the context-menu path with the sidebar closed.
// Playwright can't click a context menu, so the menu's real `onClicked`
// listener is fired from the service worker with `dispatch`. The all-sites
// grant is seeded (decisions.md T05-14): headless Chromium keeps permission
// prompts pending, so the per-site request (D10) is covered by component
// tests. Screens: test-results/screens/T07-*.png.

const ARTICLE = 'Night trains return to Europe | The Fixture Times';
const DASHBOARD = 'Fixture dashboard';
const BLANK = 'Blank fixture page';
const SLOW = 'Quarterly rail report';
const MENU_ID = 'sidekick-pin';

interface ChromeApi {
  tabs: { query(q: object): Promise<{ id?: number; windowId?: number; url?: string }[]> };
  contextMenus: {
    update(id: string, props: object): Promise<void>;
    onClicked: { dispatch(info: object, tab: object): void };
  };
  sidePanel: { open(options: { windowId?: number }): Promise<void> };
}

/**
 * Records `sidePanel.open` calls in the background instead of making them:
 * a dispatched click is no user gesture, so Chrome would refuse the real
 * call, and headless Chromium has no side panel to look at (D17).
 */
async function recordSidePanelOpens(context: BrowserContext): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() => {
    const scope = globalThis as unknown as {
      chrome: ChromeApi;
      sidePanelOpens: { windowId?: number }[];
    };
    scope.sidePanelOpens = [];
    scope.chrome.sidePanel.open = (options) => {
      scope.sidePanelOpens.push({ ...options });
      return Promise.resolve();
    };
  });
}

/** Fires the menu listener and returns the `sidePanel.open` calls made before it returned. */
async function menuClickOpens(
  context: BrowserContext,
  url: string,
): Promise<(number | undefined)[]> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return worker.evaluate(
    async ({ u, id }) => {
      const scope = globalThis as unknown as {
        chrome: ChromeApi;
        sidePanelOpens: { windowId?: number }[];
      };
      const [tab] = await scope.chrome.tabs.query({ url: u });
      if (!tab) return [];
      scope.sidePanelOpens.length = 0;
      scope.chrome.contextMenus.onClicked.dispatch(
        { menuItemId: id, pageUrl: u, editable: false },
        tab,
      );
      // Read synchronously after the dispatch: only calls made in the
      // handler itself, before any await, are in the list by now.
      return scope.sidePanelOpens.map((o) => o.windowId);
    },
    { u: url, id: MENU_ID },
  );
}

const currentRow = (page: Page) => page.locator('.tab-row[data-current]');
const pinRow = (page: Page, title: string) => page.locator('li.pin-row', { hasText: title });
const tabsHeading = (page: Page, n: number) =>
  page.getByRole('button', { name: `Session tabs (${String(n)})` });

/** Fires the real "Pin to Sidekick" listener in the background for the tab at `url`. */
async function menuClick(context: BrowserContext, url: string): Promise<boolean> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return worker.evaluate(
    async ({ u, id }) => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      const [tab] = await chrome.tabs.query({ url: u });
      if (!tab) return false;
      chrome.contextMenus.onClicked.dispatch({ menuItemId: id, pageUrl: u, editable: false }, tab);
      return true;
    },
    { u: url, id: MENU_ID },
  );
}

test.describe('pinning', () => {
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

  test('pin from the needle, duplicates, failure, refresh, unpin, eye and collapse', async () => {
    const profile = await newProfile();
    removeProfile = profile.remove;
    context = await launchWithGrantedOrigins(profile.dir, ['<all_urls>']);
    const id = await extensionId(context);

    // The menu item exists (created on install).
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const menuExists = await worker.evaluate(async (menuId) => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      try {
        await chrome.contextMenus.update(menuId, {});
        return true;
      } catch {
        return false;
      }
    }, MENU_ID);
    expect(menuExists).toBe(true);

    const article = context.pages()[0] ?? (await context.newPage());
    await article.goto(server.url('article.html'));
    const sidebar = await openSidebarWindow(context, id);
    await expect(currentRow(sidebar)).toContainText(ARTICLE);
    await expect(tabsHeading(sidebar, 1)).toBeVisible();

    // Needle: pinned, ready, shown once with the marker; the session is named after it.
    await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
    await expect(pinRow(sidebar, ARTICLE)).toHaveAttribute('data-status', 'ready');
    await expect(pinRow(sidebar, ARTICLE)).toContainText('Current tab');
    await expect(pinRow(sidebar, ARTICLE)).toContainText('Page');
    await expect(tabsHeading(sidebar, 1)).toBeVisible();
    await expect(sidebar.getByRole('button', { name: `Session title: ${ARTICLE}` })).toBeVisible();

    // A second page, pinned while it is the current tab.
    const dashboard = await context.newPage();
    await dashboard.goto(server.url('non-article.html'));
    await dashboard.bringToFront();
    await expect(currentRow(sidebar)).toContainText(DASHBOARD);
    await expect(tabsHeading(sidebar, 2)).toBeVisible();
    await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
    await expect(pinRow(sidebar, DASHBOARD)).toHaveAttribute('data-status', 'ready');
    await expect(pinRow(sidebar, DASHBOARD)).toHaveAttribute('data-current', '');
    await expect(tabsHeading(sidebar, 2)).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Pin to session' })).toHaveCount(0);
    await screen(sidebar, 'T07-04-pinned-current-tab');

    // Two pins plus an unpinned current tab.
    const blank = await context.newPage();
    await blank.goto(server.url('empty.html'));
    await blank.bringToFront();
    await expect(currentRow(sidebar)).toContainText(BLANK);
    await expect(tabsHeading(sidebar, 3)).toBeVisible();
    await screens(sidebar, 'T07-01-two-pins-and-current-tab');

    // The eye excludes the current tab until another tab becomes current.
    await currentRow(sidebar).getByRole('button', { name: 'Exclude from questions' }).click();
    await expect(currentRow(sidebar)).toContainText('Not included in questions');
    await expect(
      currentRow(sidebar).getByRole('button', { name: 'Include in questions' }),
    ).toBeVisible();
    await screen(sidebar, 'T07-05-eye-excluded');
    await article.bringToFront();
    await expect(pinRow(sidebar, ARTICLE)).toHaveAttribute('data-current', '');
    await blank.bringToFront();
    await expect(currentRow(sidebar)).toContainText(BLANK);
    await expect(
      currentRow(sidebar).getByRole('button', { name: 'Exclude from questions' }),
    ).toBeVisible();

    // A page without text fails with its reason.
    await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
    await expect(pinRow(sidebar, BLANK)).toHaveAttribute('data-status', 'failed');
    await expect(pinRow(sidebar, BLANK)).toContainText('No readable text was found on this page.');
    await screen(sidebar, 'T07-03-failed');

    // A duplicate from the context menu: refused, "Already pinned" with Refresh.
    expect(await menuClick(context, server.url('article.html'))).toBe(true);
    const notice = sidebar.getByRole('status').filter({ hasText: 'Already pinned' });
    await expect(notice).toBeVisible();
    await expect(sidebar.locator('li.pin-row')).toHaveCount(3);
    await screen(sidebar, 'T07-07-already-pinned');
    await notice.getByRole('button', { name: 'Refresh' }).click();
    await expect(notice).toHaveCount(0);
    await expect(pinRow(sidebar, ARTICLE)).toHaveAttribute('data-status', 'ready');

    // A page that is still loading stays "extracting" until it has loaded.
    const release = server.holdSlowPage();
    const slow = await context.newPage();
    await slow.goto(server.url('slow.html'), { waitUntil: 'commit' });
    await slow.bringToFront();
    await expect(currentRow(sidebar)).toContainText(SLOW);
    await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
    await expect(pinRow(sidebar, SLOW)).toHaveAttribute('data-status', 'extracting');
    await expect(pinRow(sidebar, SLOW)).toContainText('Extracting…');
    await screen(sidebar, 'T07-02-extracting');
    release();
    await expect(pinRow(sidebar, SLOW)).toHaveAttribute('data-status', 'ready');

    // Refresh re-reads the open tab.
    await sidebar.getByRole('button', { name: `Refresh “${DASHBOARD}”` }).click();
    await expect(pinRow(sidebar, DASHBOARD)).toHaveAttribute('data-status', 'ready');

    // Refresh is offered only while the page is open.
    await dashboard.close();
    await expect(sidebar.getByRole('button', { name: `Refresh “${DASHBOARD}”` })).toHaveCount(0);

    // Unpin.
    await sidebar.getByRole('button', { name: `Unpin “${ARTICLE}”` }).click();
    await expect(pinRow(sidebar, ARTICLE)).toHaveCount(0);
    await expect(sidebar.locator('li.pin-row')).toHaveCount(3);

    // Collapse and expand; the state is remembered.
    await tabsHeading(sidebar, 3).click();
    await expect(tabsHeading(sidebar, 3)).toHaveAttribute('aria-expanded', 'false');
    await screen(sidebar, 'T07-06-collapsed');
    await sidebar.reload();
    await expect(tabsHeading(sidebar, 3)).toHaveAttribute('aria-expanded', 'false');
    await tabsHeading(sidebar, 3).click();
    await expect(pinRow(sidebar, SLOW)).toBeVisible();
  });

  test('the context menu pins with the sidebar closed', async () => {
    const profile = await newProfile();
    removeProfile = profile.remove;
    context = await launchWithGrantedOrigins(profile.dir, ['<all_urls>']);
    const id = await extensionId(context);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(server.url('article.html'));

    // No sidebar has ever been open: the background creates the active session.
    // The click also asks the browser to open the side panel of that window,
    // synchronously in the handler (D17).
    await recordSidePanelOpens(context);
    const opens = await menuClickOpens(context, server.url('article.html'));
    expect(opens).toHaveLength(1);
    expect(typeof opens[0]).toBe('number');
    const sidebar = await openSidebarWindow(context, id);
    await expect(pinRow(sidebar, ARTICLE)).toHaveAttribute('data-status', 'ready');
    await expect(pinRow(sidebar, ARTICLE)).toHaveAttribute('data-current', '');
    await expect(sidebar.getByRole('button', { name: `Session title: ${ARTICLE}` })).toBeVisible();

    // Close the sidebar, pin another page, reopen: the pin is there.
    await sidebar.close();
    const dashboard = await context.newPage();
    await dashboard.goto(server.url('non-article.html'));
    expect(await menuClickOpens(context, server.url('non-article.html'))).toHaveLength(1);
    const again = await openSidebarWindow(context, id);
    await expect(pinRow(again, DASHBOARD)).toHaveAttribute('data-status', 'ready');
    await expect(again.locator('li.pin-row')).toHaveCount(2);
    // The first pin's title stays the session title.
    await expect(again.getByRole('button', { name: `Session title: ${ARTICLE}` })).toBeVisible();

    // A duplicate with the sidebar closed: the sidebar the click opens still
    // gets "Already pinned", although it starts listening after the click.
    await again.close();
    expect(await menuClickOpens(context, server.url('non-article.html'))).toHaveLength(1);
    const reopened = await openSidebarWindow(context, id);
    await expect(reopened.getByRole('status')).toContainText('Already pinned');
    await expect(reopened.locator('li.pin-row')).toHaveCount(2);
  });
});
