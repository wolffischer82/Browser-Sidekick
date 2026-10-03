import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MOCK_MODELS, startMockLlm, type MockLlm } from '../mock-llm/server';
import { startFixtureServer, type FixtureServer } from './fixture-server';
import {
  extensionId,
  launchWithExtension,
  launchWithGrantedOrigins,
  newProfile,
  openSidebarWindow,
  screens,
} from './extension';
import { NO_YOUTUBE_ARGS, serveYouTube } from './youtube-fixtures';

// T19 (specs/redesign.md 5.2, 5.5): the numbered Session tabs rows and the
// banners. Pins of each type and state (page, a failed page, YouTube, PDF,
// a truncated page, one still extracting), then the unpinned current tab;
// the numbers on the rows are checked against the pages the mock LLM
// receives and a cited answer, with the current tab unpinned, excluded and
// pinned. Row actions show on hover and on keyboard focus, and a pin opens
// by keyboard. The first run shows the banner card, a deleted provider the
// notice card. Screens:
// test-results/screens/T19-*.png.

const KEY = 'sk-mock-session-tabs-e2e-5c2d';
const ARTICLE = 'Night trains return to Europe | The Fixture Times';
const BLANK = 'Blank fixture page';
const VIDEO = 'Placeholder captioned video - YouTube';
const PDF = 'Night trains in Europe';
const BIG = 'Long fixture page';
const SLOW = 'Quarterly rail report';
const DASHBOARD = 'Fixture dashboard';

/** A page whose text passes the 200,000-character cap, served by request interception. */
const BIG_HTML =
  `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${BIG}</title></head>` +
  `<body><article><h1>${BIG}</h1>` +
  Array.from(
    { length: 2400 },
    (_, i) =>
      `<p>Paragraph ${String(i)} about sleeper trains, timetables, carriages and routes across Europe.</p>`,
  ).join('') +
  '</article></body></html>';

interface ChromeApi {
  storage: { local: { set(o: object): Promise<void> } };
}

interface ChatBody {
  messages?: { role: string; content: string }[];
}

const toggle = (page: Page) => page.locator('.session-tabs-toggle');
const currentRow = (page: Page) => page.locator('.tab-row[data-current]');
const pinRows = (page: Page) => page.locator('li.pin-row');
const pinRow = (page: Page, title: string) => page.locator('li.pin-row', { hasText: title });
const number = (row: ReturnType<typeof pinRow>) => row.locator('.citation-number');
const input = (page: Page) => page.getByRole('textbox', { name: 'Ask about these pages…' });
const answers = (page: Page) => page.getByRole('article', { name: 'Answer' });

/** The system texts of the questions asked, in order. */
function systems(mock: MockLlm): string[] {
  return (
    mock.requests
      .filter((r) => r.path === '/v1/chat/completions')
      .map((r) => ((r.body ?? {}) as ChatBody).messages?.find((m) => m.role === 'system')?.content)
      .filter((s): s is string => typeof s === 'string')
      // Questions only, not the title request that may follow the first answer.
      .filter((s) => s.startsWith('You are Browser Sidekick'))
  );
}

/** The page numbers in a request's system text, with the title under each. */
function pagesOf(system: string): [number, string][] {
  return [...system.matchAll(/<<<PAGE (\d+)>>>\nTitle: ([^\n]*)/g)].map((m) => [
    Number(m[1]),
    m[2] ?? '',
  ]);
}

/** The number and title on each listed row with a number, in list order. */
async function numberedRows(page: Page): Promise<[number, string][]> {
  return page.locator('.tab-rows > li').evaluateAll((rows) =>
    rows.flatMap((row) => {
      const n = row.querySelector('.citation-number')?.textContent;
      const title = row.querySelector('.tab-row-title')?.textContent ?? '';
      return n ? [[Number(n), title] as [number, string]] : [];
    }),
  );
}

async function seedProvider(sidebar: Page, mock: MockLlm): Promise<void> {
  await sidebar.evaluate(
    async ({ baseUrl, key, models }) => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      await chrome.storage.local.set({
        providers: [
          {
            id: 'mock',
            kind: 'openai-compatible',
            label: 'Mock server',
            baseUrl,
            apiKey: key,
            defaultModel: 'mock-large',
            contextBudget: 1_000_000,
            cachedModels: models,
            hasAccess: true,
          },
        ],
        defaultProviderId: 'mock',
      });
    },
    { baseUrl: mock.baseUrl, key: KEY, models: MOCK_MODELS },
  );
}

async function ask(page: Page, question: string): Promise<void> {
  await input(page).fill(question);
  await input(page).press('Enter');
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
}

/** Whether `locator` is drawn: not clipped away as visually hidden. */
async function drawn(locator: ReturnType<Page['locator']>): Promise<boolean> {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && getComputedStyle(el).clipPath === 'none';
  });
}

test.describe('session tabs', () => {
  let server: FixtureServer;
  let mock: MockLlm;
  let context: BrowserContext | undefined;
  let removeProfile: (() => Promise<void>) | undefined;

  test.beforeEach(async () => {
    server = await startFixtureServer();
    mock = await startMockLlm({ apiKey: KEY });
  });

  test.afterEach(async () => {
    await context?.close();
    await removeProfile?.();
    await mock.close();
    await server.close();
    context = undefined;
  });

  test('first run: the access banner card and the not-accessible row', async () => {
    const profile = await newProfile();
    removeProfile = profile.remove;
    const browser = await launchWithExtension(profile.dir);
    context = browser;
    const id = await extensionId(browser);
    const tab = browser.pages()[0] ?? (await browser.newPage());
    await tab.goto(server.url('article.html'));
    const sidebar = await openSidebarWindow(browser, id);

    const banner = sidebar.getByRole('region', { name: 'Page access' });
    await expect(banner).toBeVisible();
    await expect(banner.locator('.access-banner-tile svg')).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Allow on all sites' })).toHaveClass(
      /button-primary/,
    );
    await expect(banner.getByRole('button', { name: 'Dismiss' })).toHaveClass(/button-plain/);
    await expect(currentRow(sidebar)).toHaveAttribute('data-state', 'noAccess');
    await expect(currentRow(sidebar)).toContainText('Current tab not accessible');
    await expect(currentRow(sidebar).locator('.citation-number')).toHaveCount(0);
    await expect(toggle(sidebar)).toHaveAccessibleName('Session tabs 1');
    await expect(currentRow(sidebar)).toHaveCSS('border-top-style', 'dashed');
    await screens(sidebar, 'T19-01-first-run');
  });

  test('numbers match the citations; actions on hover and focus; open by keyboard', async () => {
    test.setTimeout(180_000);
    const profile = await newProfile();
    removeProfile = profile.remove;
    const browser = await launchWithGrantedOrigins(profile.dir, ['<all_urls>'], NO_YOUTUBE_ARGS);
    context = browser;
    await serveYouTube(browser);
    await browser.route(server.url('big.html'), (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: BIG_HTML }),
    );
    const id = await extensionId(browser);
    const tab = browser.pages()[0] ?? (await browser.newPage());
    await tab.goto(server.url('article.html'));
    const sidebar = await openSidebarWindow(browser, id);
    await seedProvider(sidebar, mock);
    await sidebar.reload();
    await sidebar.setViewportSize({ width: 400, height: 1000 });

    /** Opens `url` in the tab and pins it from the current-tab row. */
    async function pin(url: string, title: string, status: string): Promise<void> {
      await tab.goto(url);
      await expect(currentRow(sidebar)).toContainText(title);
      await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
      await expect(pinRow(sidebar, title)).toHaveAttribute('data-status', status);
    }

    // 1. A pin of each type and state.
    await pin(server.url('article.html'), ARTICLE, 'ready');
    await pin(server.url('empty.html'), BLANK, 'failed');
    await pin('https://www.youtube.com/watch?v=VIDEO000001', VIDEO, 'ready');
    await pin(server.url('pdf/text.pdf'), PDF, 'ready');
    await pin(server.url('big.html'), BIG, 'ready');
    const release = server.holdSlowPage();
    // The slow page keeps loading in its own tab, so its pin stays extracting.
    const slow = await browser.newPage();
    await slow.goto(server.url('slow.html'), { waitUntil: 'commit' });
    await slow.bringToFront();
    await expect(currentRow(sidebar)).toContainText(SLOW);
    await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
    await expect(pinRow(sidebar, SLOW)).toHaveAttribute('data-status', 'extracting');
    await tab.bringToFront();
    await tab.goto(server.url('non-article.html'));
    await expect(currentRow(sidebar)).toContainText(DASHBOARD);

    // Toggle, rows and their meta lines.
    await expect(toggle(sidebar)).toHaveAccessibleName('Session tabs 7');
    await expect(toggle(sidebar).locator('.count-pill')).toHaveText('7');
    await expect(pinRows(sidebar).locator('.citation-number')).toHaveText([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    await expect(number(currentRow(sidebar))).toHaveText('7');
    await expect(pinRow(sidebar, ARTICLE).locator('.tab-row-kind')).toHaveText('Page');
    await expect(pinRow(sidebar, VIDEO).locator('.tab-row-kind')).toHaveText('YouTube');
    await expect(pinRow(sidebar, PDF).locator('.tab-row-kind')).toHaveText('PDF');
    await expect(pinRow(sidebar, BIG).locator('.pin-truncated')).toHaveText('Truncated');
    await expect(pinRow(sidebar, BLANK).locator('.pin-status-failed')).toHaveText('Failed');
    await expect(pinRow(sidebar, BLANK).locator('.tab-row-error')).toBeVisible();
    await expect(pinRow(sidebar, SLOW).locator('.pin-status-extracting')).toHaveText('Extracting…');
    await expect(pinRow(sidebar, ARTICLE).locator('.status-dot')).toBeVisible();
    await expect(currentRow(sidebar).locator('.tab-row-current')).toHaveText('Current tab');
    await expect(currentRow(sidebar).getByRole('button', { name: 'Pin to session' })).toHaveText(
      'Pin',
    );
    // Without hover or focus, the status shows and the actions don't. (Pinning
    // moved the focus to the new row's Unpin button.)
    await sidebar.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await sidebar.mouse.move(399, 999);
    expect(await drawn(pinRow(sidebar, SLOW).locator('.pin-status'))).toBe(true);
    const article = pinRow(sidebar, ARTICLE);
    expect(await drawn(article.locator('.pin-status'))).toBe(true);
    expect(await drawn(article.locator('.tab-row-actions'))).toBe(false);
    await screens(sidebar, 'T19-02-all-states');

    // 2. Hover: the actions replace the status, on a sunken row.
    await article.hover();
    expect(await drawn(article.locator('.tab-row-actions'))).toBe(true);
    expect(await drawn(article.locator('.pin-status'))).toBe(false);
    const [rowBg, sunken] = await article.evaluate((row) => [
      getComputedStyle(row).backgroundColor,
      (() => {
        const probe = document.createElement('div');
        probe.style.background = 'var(--sunken)';
        document.body.append(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      })(),
    ]);
    expect(rowBg).toBe(sunken);
    await screens(sidebar, 'T19-03-row-hovered');
    await sidebar.mouse.move(399, 999);
    release();
    await expect(pinRow(sidebar, SLOW)).toHaveAttribute('data-status', 'ready');

    // 3. Ask: the request numbers the pages exactly as the rows do.
    mock.script({
      kind: 'stream',
      chunks: ['Trains are back [1], the video agrees [3], and the dashboard shows it [7].'],
    });
    await ask(sidebar, 'What is new?');
    const shown = await numberedRows(sidebar);
    const sent = pagesOf(systems(mock).at(-1) ?? '');
    // Every numbered row but the failed pin is sent, under its number.
    expect(sent).toEqual(shown.filter(([, title]) => title !== BLANK));
    expect(sent.map(([n]) => n)).toEqual([1, 3, 4, 5, 6, 7]);
    const answer = answers(sidebar).last();
    await expect(answer.getByRole('button', { name: `Source 1: ${ARTICLE}` })).toBeVisible();
    await expect(answer.getByRole('button', { name: `Source 3: ${VIDEO}` })).toBeVisible();
    await expect(answer.getByRole('button', { name: `Source 7: ${DASHBOARD}` })).toBeVisible();

    // 4. Excluded: the current tab has no number and isn't sent.
    await currentRow(sidebar).getByRole('button', { name: 'Exclude from questions' }).click();
    await expect(currentRow(sidebar).locator('.citation-number')).toHaveCount(0);
    await expect(currentRow(sidebar)).toContainText('Not included in questions');
    await ask(sidebar, 'And now?');
    expect(pagesOf(systems(mock).at(-1) ?? '').map(([n]) => n)).toEqual([1, 3, 4, 5, 6]);
    await currentRow(sidebar).getByRole('button', { name: 'Include in questions' }).click();

    // 5. The current tab pinned: no separate row; its pin keeps its number.
    await tab.goto(server.url('pdf/text.pdf'));
    await expect(pinRow(sidebar, PDF)).toHaveAttribute('data-current', '');
    await expect(pinRow(sidebar, PDF).locator('.tab-row-current')).toHaveText('Current tab');
    await expect(sidebar.locator('.current-row')).toHaveCount(0);
    await expect(toggle(sidebar)).toHaveAccessibleName('Session tabs 6');
    await ask(sidebar, 'Once more');
    expect(pagesOf(systems(mock).at(-1) ?? '')).toEqual(
      (await numberedRows(sidebar)).filter(([, title]) => title !== BLANK),
    );

    // 6. Keyboard: Tab reaches a pin's actions, which then show; Enter opens the page.
    await toggle(sidebar).focus();
    const open = sidebar.getByRole('button', { name: `Open “${ARTICLE}”` });
    for (let i = 0; i < 10 && !(await open.evaluate((el) => el === document.activeElement)); i++) {
      await sidebar.keyboard.press('Tab');
    }
    await expect(open).toBeFocused();
    expect(await drawn(article.locator('.tab-row-actions'))).toBe(true);
    expect(await drawn(article.locator('.pin-status'))).toBe(false);
    await expect(open).toHaveCSS('outline-style', 'solid');
    await sidebar.keyboard.press('Tab');
    await expect(article.getByRole('button', { name: `Unpin “${ARTICLE}”` })).toBeFocused();
    await sidebar.keyboard.press('Shift+Tab');
    const [opened] = await Promise.all([
      browser.waitForEvent('page', (p) => p.url() === server.url('article.html')),
      sidebar.keyboard.press('Enter'),
    ]);
    expect(opened.url()).toBe(server.url('article.html'));

    // 7. Collapsed.
    await toggle(sidebar).click();
    await expect(toggle(sidebar)).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar.locator('#session-tabs-body')).toBeHidden();
    await sidebar.mouse.move(399, 999);
    await screens(sidebar, 'T19-04-collapsed');

    // 8. The provider notice (redesign spec 5.5): a warning notice card.
    await sidebar.evaluate(async (baseUrl) => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      await chrome.storage.local.set({
        providers: [
          {
            id: 'other',
            kind: 'openai-compatible',
            label: 'Other server',
            baseUrl,
            apiKey: 'sk-other',
            defaultModel: 'mock-small',
            contextBudget: 100_000,
            cachedModels: [],
            hasAccess: true,
          },
        ],
        defaultProviderId: 'other',
      });
    }, mock.baseUrl);
    const notice = sidebar.locator('p.notice');
    await expect(notice).toHaveText(
      "This session's provider was deleted. It now uses the default provider.",
    );
    await expect(notice).toHaveCSS('border-top-left-radius', '10px');
    await expect(notice).toHaveCSS('border-top-style', 'solid');
    await screens(sidebar, 'T19-05-provider-notice');
  });
});
