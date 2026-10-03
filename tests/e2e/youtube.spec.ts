import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  extensionId,
  launchWithGrantedOrigins,
  newProfile,
  openSidebarWindow,
  screens,
} from './extension';
import { NO_YOUTUBE_ARGS, serveYouTube } from './youtube-fixtures';

// T08: pinning YouTube videos. The watch pages and InnerTube `get_panel` are
// served by Playwright's request interception from the trimmed, synthetic
// fixtures in tests/fixtures/youtube, so the browser shows youtube.com URLs
// without contacting YouTube (spec T08 Tests: no live network). Every other
// request to a YouTube host is aborted, and the host resolver maps those
// hosts to a closed local port as a second guard. Live checks are manual
// (docs/owner-checklist.md). Screens: test-results/screens/T08-*.png.

const CAPTIONED_TAB = 'Placeholder captioned video - YouTube';
const SILENT_TAB = 'Placeholder silent video - YouTube';
const SHORT_TAB = 'Placeholder captioned short #shorts - YouTube';

const currentRow = (page: Page) => page.locator('.tab-row[data-current]');
const pinRow = (page: Page, title: string) => page.locator('li.pin-row', { hasText: title });

/** The stored snapshot text of the pin titled `title`, read from IndexedDB in the sidebar. */
async function pinText(sidebar: Page, title: string): Promise<string> {
  return sidebar.evaluate(async (t) => {
    const db = await new Promise<IDBDatabase>((done, fail) => {
      const request = indexedDB.open('sidekick');
      request.onsuccess = () => {
        done(request.result);
      };
      request.onerror = () => {
        fail(new Error('open failed'));
      };
    });
    const pins = await new Promise<{ title: string; text: string }[]>((done, fail) => {
      const request = db.transaction('pins').objectStore('pins').getAll();
      request.onsuccess = () => {
        done(request.result as { title: string; text: string }[]);
      };
      request.onerror = () => {
        fail(new Error('read failed'));
      };
    });
    db.close();
    return pins.find((pin) => pin.title === t)?.text ?? '';
  }, title);
}

test.describe('YouTube', () => {
  let context: BrowserContext | undefined;
  let removeProfile: (() => Promise<void>) | undefined;

  test.afterEach(async () => {
    await context?.close();
    await removeProfile?.();
    context = undefined;
  });

  test('pins a captioned video, a video without captions after in-app navigation, and a Short', async () => {
    const profile = await newProfile();
    removeProfile = profile.remove;
    context = await launchWithGrantedOrigins(profile.dir, ['<all_urls>'], NO_YOUTUBE_ARGS);
    const languages = await serveYouTube(context);
    const id = await extensionId(context);

    const video = context.pages()[0] ?? (await context.newPage());
    await video.goto('https://www.youtube.com/watch?v=VIDEO000001');
    const sidebar = await openSidebarWindow(context, id);
    await expect(currentRow(sidebar)).toContainText(CAPTIONED_TAB);

    // A captioned video: its transcript, in the page's language, with the YouTube type.
    await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
    const captioned = pinRow(sidebar, CAPTIONED_TAB);
    await expect(captioned).toHaveAttribute('data-status', 'ready');
    await expect(captioned.locator('.tab-row-kind')).toHaveText('YouTube');
    expect(languages).toEqual(['en']);
    expect(await pinText(sidebar, CAPTIONED_TAB)).toMatch(
      /^\[00:01\] This is a synthetic first sentence\.[^\n]*\n\[00:33\] /,
    );

    // YouTube's in-app navigation: the URL and title change, the page globals don't.
    await video.evaluate(() => {
      history.pushState({}, '', '/watch?v=VIDEO000002');
      document.title = 'Placeholder silent video - YouTube';
    });
    await expect(currentRow(sidebar)).toContainText(SILENT_TAB);
    await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
    const silent = pinRow(sidebar, SILENT_TAB);
    await expect(silent).toHaveAttribute('data-status', 'ready');
    await expect(silent.locator('.tab-row-kind')).toHaveText('YouTube');
    expect(await pinText(sidebar, SILENT_TAB)).toBe(
      'Placeholder silent video\n\nSynthetic footage without speech.\n\nNo transcript available.',
    );
    expect(languages).toEqual(['en']);

    // A Short.
    await video.goto('https://www.youtube.com/shorts/VIDEO000003');
    await expect(currentRow(sidebar)).toContainText(SHORT_TAB);
    await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
    const short = pinRow(sidebar, SHORT_TAB);
    await expect(short).toHaveAttribute('data-status', 'ready');
    await expect(short.locator('.tab-row-kind')).toHaveText('YouTube');
    expect(await pinText(sidebar, SHORT_TAB)).toMatch(/^\[00:01\] This is a synthetic/);
    expect(languages).toEqual(['en', 'en']);

    await screens(sidebar, 'T08-01-youtube-pin');
  });
});
