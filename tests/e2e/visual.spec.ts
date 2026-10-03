import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { chunkText, MOCK_MODELS, startMockLlm, type MockLlm } from '../mock-llm/server';
import { startFixtureServer, type FixtureServer } from './fixture-server';
import {
  extensionId,
  launchWithExtension,
  launchWithGrantedOrigins,
  newProfile,
  openSidebar,
  openSidebarWindow,
  screens,
} from './extension';

// Redesign T17: the visual foundation. The bundled Geist fonts load from the
// extension itself and nothing else is requested; every element reached with
// Tab shows the accent focus ring. Screens: test-results/screens/T17-*.png
// (light and dark, 400 px wide).

const KEY = 'sk-mock-visual-e2e-17a0';
const ARTICLE = 'Night trains return to Europe | The Fixture Times';

const ANSWER = [
  'Night trains are coming back across Europe [1].',
  '',
  '- **Vienna to Amsterdam** runs three times a week [1]',
  '- The timetable uses `21:04` as the departure [2]',
  '',
  '```text',
  'Departure 21:04',
  'Arrival   08:47',
  '```',
].join('\n');

interface ChromeApi {
  storage: { local: { set(o: object): Promise<void> } };
}

const input = (page: Page) => page.getByRole('textbox', { name: 'Ask about these pages…' });
const currentRow = (page: Page) => page.locator('.tab-row[data-current]');
const pinRow = (page: Page, title: string) => page.locator('li.pin-row', { hasText: title });

/** Stores a provider pointing at the mock server (the settings flow is T05's e2e). */
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
            contextBudget: 100_000,
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

/**
 * Presses Tab through the page and returns, for each element that took focus,
 * a description and whether it showed the 2 px accent ring with 2 px offset.
 */
async function focusRings(page: Page, presses: number): Promise<{ what: string; ok: boolean }[]> {
  const accent = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  const seen: { what: string; ok: boolean }[] = [];
  await page.locator('body').focus();
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press('Tab');
    const result = await page.evaluate((ring) => {
      const el = document.activeElement;
      if (!el || el === document.body) return undefined;
      const style = getComputedStyle(el);
      const name =
        el.getAttribute('aria-label') ??
        el.getAttribute('title') ??
        el.textContent?.trim().slice(0, 30) ??
        '';
      return {
        what: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${name}"`,
        ok:
          el.matches(':focus-visible') &&
          style.outlineStyle === 'solid' &&
          style.outlineWidth === '2px' &&
          style.outlineOffset === '2px' &&
          style.outlineColor === ring,
      };
    }, accent);
    if (result && !seen.some((s) => s.what === result.what)) seen.push(result);
  }
  return seen;
}

test.describe('visual foundation', () => {
  let context: BrowserContext | undefined;
  let removeProfile: (() => Promise<void>) | undefined;

  test.afterEach(async () => {
    await context?.close();
    await removeProfile?.();
    context = undefined;
  });

  test('fonts load from the extension, no network request for them', async () => {
    const profile = await newProfile();
    removeProfile = profile.remove;
    context = await launchWithExtension(profile.dir);
    const id = await extensionId(context);
    const origin = `chrome-extension://${id}/`;

    const requested: string[] = [];
    context.on('request', (request) => {
      requested.push(request.url());
    });
    const page = await openSidebar(context, id);
    await expect(input(page)).toBeVisible();

    // Geist Mono is only used by code and counts; ask for it so it loads too.
    const fonts = await page.evaluate(async () => {
      await document.fonts.load('14px Geist');
      await document.fonts.load('12px "Geist Mono"');
      await document.fonts.ready;
      return {
        loaded: [...document.fonts]
          .filter((f) => f.status === 'loaded')
          .map((f) => f.family.replace(/"/g, '')),
        geist: document.fonts.check('14px Geist'),
        mono: document.fonts.check('12px "Geist Mono"'),
        body: getComputedStyle(document.body).fontFamily,
      };
    });
    expect(fonts.loaded).toContain('Geist');
    expect(fonts.loaded).toContain('Geist Mono');
    expect(fonts.geist).toBe(true);
    expect(fonts.mono).toBe(true);
    expect(fonts.body.startsWith('Geist')).toBe(true);

    // Both families came as woff2 files from the extension's own origin.
    const fontFiles = requested.filter((url) => /\.(woff2?|ttf|otf)$/.test(url));
    expect(
      fontFiles.some((url) => /\/assets\/geist-latin-wght-normal-[\w-]+\.woff2$/.test(url)),
    ).toBe(true);
    expect(
      fontFiles.some((url) => /\/assets\/geist-mono-latin-wght-normal-[\w-]+\.woff2$/.test(url)),
    ).toBe(true);
    for (const url of fontFiles) expect(url.startsWith(origin), 'font origin').toBe(true);

    // Nothing the side panel asked for left the extension (no provider is set up).
    const external = requested.filter((url) => !url.startsWith(origin));
    expect(external).toEqual([]);

    await screens(page, 'T17-01-first-run');
  });

  test('main view with pins and an answer, and focus rings', async () => {
    test.setTimeout(120_000);
    let server: FixtureServer | undefined;
    let mock: MockLlm | undefined;
    try {
      server = await startFixtureServer();
      mock = await startMockLlm({ apiKey: KEY });
      const profile = await newProfile();
      removeProfile = profile.remove;
      const browser = await launchWithGrantedOrigins(profile.dir, ['<all_urls>']);
      context = browser;
      const id = await extensionId(browser);

      const article = browser.pages()[0] ?? (await browser.newPage());
      await article.goto(server.url('article.html'));
      const sidebar = await openSidebarWindow(browser, id);
      await sidebar.setViewportSize({ width: 400, height: 720 });
      await seedProvider(sidebar, mock);
      await sidebar.reload();
      await expect(input(sidebar)).toBeEnabled();

      await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
      await expect(pinRow(sidebar, ARTICLE)).toHaveAttribute('data-status', 'ready');
      const dashboard = await browser.newPage();
      await dashboard.goto(server.url('non-article.html'));
      await dashboard.bringToFront();
      await expect(currentRow(sidebar)).toContainText('Fixture dashboard');

      mock.script(
        { kind: 'stream', chunks: chunkText(ANSWER, 8) },
        { kind: 'stream', chunks: ['"Night trains"'] },
      );
      await input(sidebar).fill('What is new with night trains?');
      await input(sidebar).press('Enter');
      const answer = sidebar.getByRole('article', { name: 'Answer' });
      await expect(answer.locator('pre code')).toContainText('Departure 21:04');
      await expect(sidebar.getByRole('button', { name: 'Stop' })).toHaveCount(0);
      await expect(sidebar.getByTitle('Rename session')).toHaveText('Night trains');
      await screens(sidebar, 'T17-02-answer');

      // Every element Tab reaches shows the ring (header, tabs, rows, citations, composer).
      const rings = await focusRings(sidebar, 40);
      expect(rings.length).toBeGreaterThan(8);
      expect(rings.filter((r) => !r.ok)).toEqual([]);
      await sidebar
        .getByRole('button', { name: /^Source 1/ })
        .first()
        .focus();
      await screens(sidebar, 'T17-03-focus-citation');
    } finally {
      await mock?.close();
      await server?.close();
    }
  });
});
