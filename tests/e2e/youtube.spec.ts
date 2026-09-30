import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import {
  extensionId,
  launchWithGrantedOrigins,
  newProfile,
  openSidebarWindow,
  screens,
} from './extension';

// T08: pinning YouTube videos. The watch pages and InnerTube `get_panel` are
// served by Playwright's request interception from the trimmed, synthetic
// fixtures in tests/fixtures/youtube, so the browser shows youtube.com URLs
// without contacting YouTube (spec T08 Tests: no live network). Every other
// request to a YouTube host is aborted, and the host resolver maps those
// hosts to a closed local port as a second guard. Live checks are manual
// (docs/owner-checklist.md). Screens: test-results/screens/T08-*.png.

const FIXTURES = resolve(import.meta.dirname, '../fixtures/youtube');
const CAPTIONED_HTML = readFileSync(resolve(FIXTURES, 'watch-captions.html'), 'utf8');
const SILENT_HTML = readFileSync(resolve(FIXTURES, 'watch-no-captions.html'), 'utf8');
const PANEL = readFileSync(resolve(FIXTURES, 'panel.json'), 'utf8');

/** Watch pages by video id; VIDEO000003 is a captioned Short. */
const WATCH_PAGES: Record<string, string> = {
  VIDEO000001: CAPTIONED_HTML,
  VIDEO000002: SILENT_HTML,
  VIDEO000003: CAPTIONED_HTML.replaceAll('VIDEO000001', 'VIDEO000003')
    .replaceAll('Placeholder captioned video', 'Placeholder captioned short')
    .replace(
      'Placeholder captioned short - YouTube',
      'Placeholder captioned short #shorts - YouTube',
    ),
};

const YOUTUBE_HOSTS =
  /^https?:\/\/([^/]+\.)?(youtube\.com|youtu\.be|ytimg\.com|googlevideo\.com|ggpht\.com)(:\d+)?\//;
const NO_YOUTUBE_ARGS = [
  '--host-resolver-rules=MAP *.youtube.com 127.0.0.1:9, MAP youtube.com 127.0.0.1:9, MAP youtu.be 127.0.0.1:9, MAP *.ytimg.com 127.0.0.1:9, MAP *.googlevideo.com 127.0.0.1:9, MAP *.ggpht.com 127.0.0.1:9',
];

const CAPTIONED_TAB = 'Placeholder captioned video - YouTube';
const SILENT_TAB = 'Placeholder silent video - YouTube';
const SHORT_TAB = 'Placeholder captioned short #shorts - YouTube';

const html = (body: string) => ({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body,
});

/** Serves the fixtures; records the `hl` of each transcript request. */
async function serveYouTube(context: BrowserContext): Promise<string[]> {
  const languages: string[] = [];
  await context.route(YOUTUBE_HOSTS, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== 'www.youtube.com') return route.abort();
    const id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : url.pathname.startsWith('/shorts/')
          ? url.pathname.split('/')[2]
          : null;
    const page = id ? WATCH_PAGES[id] : undefined;
    if (page) return route.fulfill(html(page));
    if (url.pathname === '/youtubei/v1/get_panel' && request.method() === 'POST') {
      const body = request.postDataJSON() as { context?: { client?: { hl?: string } } };
      languages.push(body.context?.client?.hl ?? '');
      return route.fulfill({ status: 200, contentType: 'application/json', body: PANEL });
    }
    return route.abort();
  });
  return languages;
}

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

    // A captioned video: its transcript, in the page's language, with the YouTube badge.
    await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
    const captioned = pinRow(sidebar, CAPTIONED_TAB);
    await expect(captioned).toHaveAttribute('data-status', 'ready');
    await expect(captioned.locator('.badge-muted')).toHaveText('YouTube');
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
    await expect(silent.locator('.badge-muted')).toHaveText('YouTube');
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
    await expect(short.locator('.badge-muted')).toHaveText('YouTube');
    expect(await pinText(sidebar, SHORT_TAB)).toMatch(/^\[00:01\] This is a synthetic/);
    expect(languages).toEqual(['en', 'en']);

    await screens(sidebar, 'T08-01-youtube-pin');
  });
});
