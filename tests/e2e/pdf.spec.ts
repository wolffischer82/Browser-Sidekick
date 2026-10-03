import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  extensionId,
  launchWithGrantedOrigins,
  newProfile,
  openSidebarWindow,
  screens,
} from './extension';
import { startFixtureServer, type FixtureServer } from './fixture-server';

// T09: pinning PDFs. The fixture PDFs (tests/fixtures/pdf) come from the local
// server and open in Chromium's PDF viewer, whose tab keeps the PDF's URL. The
// needle pins them; the background reads them in the offscreen document with
// pdf.js. A PDF behind a URL without `.pdf` is found by its Content-Type. The
// 31 MB PDF is pinned through the context menu's real listener (as in T07),
// since the viewer would download it. The all-sites grant is seeded
// (decisions.md T05-14). Screens: test-results/screens/T09-*.png.
// The 31 MB PDF's tab is a stand-in: the listener gets the PDF's URL.

const TEXT_TITLE = 'Night trains in Europe';
const MENU_ID = 'sidekick-pin';

interface ChromeApi {
  tabs: { query(q: object): Promise<{ id?: number; url?: string }[]> };
  contextMenus: { onClicked: { dispatch(info: object, tab: object): void } };
  runtime: { getContexts(filter: object): Promise<unknown[]> };
}

const currentRow = (page: Page) => page.locator('.tab-row[data-current]');
const pinRows = (page: Page) => page.locator('li.pin-row');

/** The stored snapshot of every pin, in pin order, read from IndexedDB in the sidebar. */
async function storedPins(
  sidebar: Page,
): Promise<
  { url: string; kind: string; status: string; text: string; failureReason: string | null }[]
> {
  return sidebar.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((done, fail) => {
      const request = indexedDB.open('sidekick');
      request.onsuccess = () => {
        done(request.result);
      };
      request.onerror = () => {
        fail(new Error('open failed'));
      };
    });
    type Row = {
      url: string;
      kind: string;
      status: string;
      text: string;
      failureReason: string | null;
      position: number;
    };
    const pins = await new Promise<Row[]>((done, fail) => {
      const request = db.transaction('pins').objectStore('pins').getAll();
      request.onsuccess = () => {
        done(request.result as Row[]);
      };
      request.onerror = () => {
        fail(new Error('read failed'));
      };
    });
    db.close();
    return pins.sort((a, b) => a.position - b.position);
  });
}

/** Fires the real "Pin to Sidekick" listener for a tab showing `url` (no tab needed). */
async function menuClickUrl(context: BrowserContext, tabUrl: string, pinUrl: string) {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(
    async ({ t, u, id }) => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      const [tab] = await chrome.tabs.query({ url: t });
      if (!tab) throw new Error('No tab.');
      // The tab as the browser would describe a tab showing the PDF.
      chrome.contextMenus.onClicked.dispatch(
        { menuItemId: id, pageUrl: u, editable: false },
        { ...tab, url: u, title: 'huge.pdf' },
      );
    },
    { t: tabUrl, u: pinUrl, id: MENU_ID },
  );
}

async function offscreenDocuments(context: BrowserContext): Promise<number> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return worker.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
    return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length;
  });
}

test.describe('PDF', () => {
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

  test('pins a text PDF and fails encrypted, image-only and oversized PDFs with their reasons', async () => {
    const profile = await newProfile();
    removeProfile = profile.remove;
    const browser = await launchWithGrantedOrigins(profile.dir, ['<all_urls>']);
    context = browser;
    const id = await extensionId(browser);
    const tab = browser.pages()[0] ?? (await browser.newPage());
    const sidebar = await openSidebarWindow(browser, id);
    const pinCurrent = () =>
      currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();

    // A text PDF in the viewer: Ready, with the PDF type and its text.
    await tab.goto(server.url('pdf/text.pdf'));
    await expect(currentRow(sidebar)).toContainText(TEXT_TITLE);
    await pinCurrent();
    const text = pinRows(sidebar).nth(0);
    await expect(text).toHaveAttribute('data-status', 'ready');
    await expect(text.locator('.tab-row-kind')).toHaveText('PDF');
    await expect(text).toContainText(TEXT_TITLE);

    // A password-protected PDF.
    await tab.goto(server.url('pdf/encrypted.pdf'));
    await expect(currentRow(sidebar)).toContainText('encrypted.pdf');
    await pinCurrent();
    const encrypted = pinRows(sidebar).nth(1);
    await expect(encrypted).toHaveAttribute('data-status', 'failed');
    await expect(encrypted.locator('.tab-row-kind')).toHaveText('PDF');
    await expect(encrypted.locator('.tab-row-error')).toHaveText(
      "Can't read this PDF: it's protected by a password. Pin a copy without a password instead.",
    );

    // An image-only PDF, like a scan.
    await tab.goto(server.url('pdf/image-only.pdf'));
    await expect(currentRow(sidebar)).toContainText('Scanned letter');
    await pinCurrent();
    const scan = pinRows(sidebar).nth(2);
    await expect(scan).toHaveAttribute('data-status', 'failed');
    await expect(scan.locator('.tab-row-error')).toHaveText(
      "Can't read this PDF: it has no text, only images, as in a scan. Pin a version with selectable text instead.",
    );

    // A PDF behind a URL without `.pdf`: found by its Content-Type.
    await tab.goto(server.url('view/text'));
    await expect(currentRow(sidebar)).toContainText(TEXT_TITLE);
    await pinCurrent();
    const viewed = pinRows(sidebar).nth(3);
    await expect(viewed).toHaveAttribute('data-status', 'ready');
    await expect(viewed.locator('.tab-row-kind')).toHaveText('PDF');

    // Over 30 MB, refused from the Content-Length before the body is read.
    await tab.goto(server.url('non-article.html'));
    await menuClickUrl(browser, server.url('non-article.html'), server.url('pdf/huge.pdf'));
    const huge = pinRows(sidebar).nth(4);
    await expect(huge).toHaveAttribute('data-status', 'failed');
    await expect(huge.locator('.tab-row-error')).toHaveText(
      "Can't read this PDF: it's larger than 30 MB. Only smaller PDFs can be pinned.",
    );

    const pins = await storedPins(sidebar);
    expect(pins.map((p) => [p.kind, p.status, p.failureReason])).toEqual([
      ['pdf', 'ready', null],
      ['pdf', 'failed', 'pdf-encrypted'],
      ['pdf', 'failed', 'pdf-no-text'],
      ['pdf', 'ready', null],
      ['pdf', 'failed', 'pdf-too-large'],
    ]);
    // Booleans only: no page text in the test output.
    expect(pins[0]?.text.startsWith(`${TEXT_TITLE}\nSleeper services returned`)).toBe(true);
    expect(pins[0]?.text.includes('\n\nOperators plan more cross-border connections')).toBe(true);
    expect(pins[3]?.text === pins[0]?.text).toBe(true);
    // The offscreen document is closed once no PDF is being read.
    await expect.poll(() => offscreenDocuments(browser)).toBe(0);

    await tab.goto(server.url('article.html'));
    await screens(sidebar, 'T09-01-pdf-pins');
    await huge.scrollIntoViewIfNeeded();
    await screens(sidebar, 'T09-02-pdf-too-large');
  });
});
