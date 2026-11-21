import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MOCK_MODELS, startMockLlm, type MockLlm } from '../mock-llm/server';
import { startFixtureServer, type FixtureServer } from './fixture-server';
import {
  extensionId,
  launchWithGrantedOrigins,
  newProfile,
  openSidebarWindow,
  screens,
} from './extension';

// T27: the Summarize split button against the mock LLM
// (specs/summary-levels.md 4.2, O4-O6). The arrow opens the menu of levels,
// Standard checked at first; the keyboard moves through it and Escape
// returns to the arrow; picking Short sends the Short prompt (checked on the
// mock's prompt log) and labels the transcript "Summarize · Short". A new
// session's main part then summarizes at Short again, and a reopened side
// panel still checks Short. Screens: test-results/screens/T27-*.png.

const KEY = 'sk-mock-summary-levels-e2e-5b8e';
const ARTICLE = 'Night trains return to Europe | The Fixture Times';

interface Messages {
  [key: string]: { message: string } | undefined;
}

const EN = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../public/_locales/en/messages.json'), 'utf8'),
) as Messages;
const SHORT_PROMPT = EN.summarizePromptShort?.message ?? '';
const STANDARD_PROMPT = EN.summarizePrompt?.message ?? '';

interface ChromeApi {
  storage: { local: { set(o: object): Promise<void>; get(k: string): Promise<object> } };
}

const main = (page: Page) => page.locator('#summarize-button');
const arrow = (page: Page) => page.getByRole('button', { name: 'Summary level', exact: true });
const menu = (page: Page) => page.getByRole('menu', { name: 'Summary level' });
const item = (page: Page, name: string) => page.getByRole('menuitemradio', { name, exact: true });
const checkedItems = (page: Page) => page.locator('[role="menuitemradio"][aria-checked="true"]');
const questions = (page: Page) => page.getByRole('article', { name: 'Your question' });
const answers = (page: Page) => page.getByRole('article', { name: 'Answer' });
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop' });
const currentRow = (page: Page) => page.locator('.tab-row[data-current]');

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

/** Waits for a summary to finish and the button to be usable again. */
async function settled(sidebar: Page): Promise<void> {
  await expect(stopButton(sidebar)).toHaveCount(0, { timeout: 20_000 });
  await expect(main(sidebar)).toHaveAttribute('aria-disabled', 'false');
}

test.describe('summary levels', () => {
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

  test('pick Short, reuse it in a new session, and keep it after reopening', async () => {
    test.setTimeout(120_000);
    const profile = await newProfile();
    removeProfile = profile.remove;
    const browser = await launchWithGrantedOrigins(profile.dir, ['<all_urls>']);
    context = browser;
    const id = await extensionId(browser);

    const article = browser.pages()[0] ?? (await browser.newPage());
    await article.goto(server.url('article.html'));
    let sidebar = await openSidebarWindow(browser, id);
    await seedProvider(sidebar, mock);
    await sidebar.reload();
    await expect(currentRow(sidebar)).toContainText(ARTICLE);
    await expect(main(sidebar)).toHaveAttribute('aria-disabled', 'false');

    // 1. Before anything was picked: Standard, in the name always, as a
    // suffix in a wide panel, the label alone at 400 px, the icon only in a
    // narrow one.
    await expect(main(sidebar)).toHaveAccessibleName('Summarize · Standard');
    await expect(arrow(sidebar)).toHaveAttribute('aria-haspopup', 'menu');
    await expect(arrow(sidebar)).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar.locator('.summarize-level')).toBeHidden();
    await screens(sidebar, 'T27-01-button-400');
    await sidebar.setViewportSize({ width: 480, height: 720 });
    await expect(sidebar.locator('.summarize-level')).toBeVisible();
    await expect(sidebar.locator('.summarize-level')).toHaveText('Standard');
    await expect(main(sidebar)).toHaveAccessibleName('Summarize · Standard');
    const modelText = sidebar.locator('#model-button .model-button-text');
    expect(await modelText.evaluate((el) => el.clientWidth)).toBeGreaterThan(0);
    await screens(sidebar, 'T27-01-button-wide');
    await sidebar.setViewportSize({ width: 320, height: 720 });
    await expect(sidebar.locator('.summarize-label')).toHaveCSS('position', 'absolute');
    await expect(main(sidebar)).toHaveAccessibleName('Summarize · Standard');
    expect(await sidebar.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await screens(sidebar, 'T27-02-button-narrow');
    await sidebar.setViewportSize({ width: 400, height: 720 });
    await expect(sidebar.locator('.summarize-label')).toHaveCSS('position', 'static');

    // 2. Keyboard: ArrowDown opens on the checked item; Escape closes onto the arrow.
    await arrow(sidebar).focus();
    await sidebar.keyboard.press('ArrowDown');
    await expect(menu(sidebar)).toBeVisible();
    await expect(arrow(sidebar)).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar.getByRole('menuitemradio')).toHaveText([
      'Very short',
      'Short',
      'Standard',
      'Detailed',
    ]);
    await expect(checkedItems(sidebar)).toHaveText(['Standard']);
    await expect(item(sidebar, 'Standard')).toBeFocused();
    await sidebar.keyboard.press('ArrowUp');
    await expect(item(sidebar, 'Short')).toBeFocused();
    await sidebar.keyboard.press('End');
    await expect(item(sidebar, 'Detailed')).toBeFocused();
    await sidebar.keyboard.press('Home');
    await expect(item(sidebar, 'Very short')).toBeFocused();
    await sidebar.keyboard.press('Escape');
    await expect(menu(sidebar)).toHaveCount(0);
    await expect(arrow(sidebar)).toBeFocused();
    await sidebar.keyboard.press('Enter');
    await expect(menu(sidebar)).toBeVisible();
    await expect(item(sidebar, 'Standard')).toBeFocused();
    await sidebar.keyboard.press('Tab');
    await expect(menu(sidebar)).toHaveCount(0);
    // A click outside closes it too.
    await arrow(sidebar).click();
    await expect(menu(sidebar)).toBeVisible();
    // The menu opens above the toolbar and stays inside the panel.
    const list = await menu(sidebar).boundingBox();
    const button = await arrow(sidebar).boundingBox();
    expect(list && button && list.y + list.height <= button.y).toBe(true);
    expect(list && list.x >= 0 && list.x + list.width <= 400).toBe(true);
    await screens(sidebar, 'T27-03-menu-open');
    await sidebar.locator('.transcript').click({ position: { x: 20, y: 20 } });
    await expect(menu(sidebar)).toHaveCount(0);
    expect(mock.prompts).toHaveLength(0);

    // 3. Pick Short: it summarizes at once, at Short, and is remembered.
    mock.script(
      { kind: 'stream', chunks: ['- Night trains ', 'are back.'], holdAt: [1] },
      { kind: 'stream', chunks: ['"Night trains"'] },
    );
    await arrow(sidebar).click();
    await item(sidebar, 'Short').click();
    await expect(menu(sidebar)).toHaveCount(0);
    await expect(questions(sidebar)).toHaveText(['Summarize · Short']);
    // While it streams, both parts are unavailable and the menu can't open.
    await expect(stopButton(sidebar)).toBeVisible();
    await expect(main(sidebar)).toHaveAttribute('aria-disabled', 'true');
    await expect(arrow(sidebar)).toHaveAttribute('aria-disabled', 'true');
    await arrow(sidebar).click({ force: true });
    await expect(menu(sidebar)).toHaveCount(0);
    // The stream waits at its hold before it is released.
    await expect(answers(sidebar).first()).toContainText('Night trains');
    mock.release();
    await settled(sidebar);
    await expect(answers(sidebar).first()).toContainText('Night trains are back.');
    expect(mock.prompts[0] === SHORT_PROMPT, 'the Short prompt').toBe(true);
    expect(SHORT_PROMPT !== STANDARD_PROMPT && SHORT_PROMPT !== '').toBe(true);
    await expect(main(sidebar)).toHaveAccessibleName('Summarize · Short');
    await sidebar.setViewportSize({ width: 480, height: 720 });
    await expect(sidebar.locator('.summarize-level')).toHaveText('Short');
    await expect(sidebar.locator('.summarize-level')).toBeVisible();
    const stored = await sidebar.evaluate(async () => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      return chrome.storage.local.get('summaryLevel');
    });
    expect(stored).toEqual({ summaryLevel: 'short' });
    await expect(sidebar.getByTitle('Rename session')).toHaveText('Night trains');
    await screens(sidebar, 'T27-04-transcript-label');

    // 4. A new session: the main part summarizes at Short again.
    await sidebar.getByRole('button', { name: 'New session', exact: true }).click();
    await expect(sidebar.getByTitle('Rename session')).toHaveText('New session');
    await expect(main(sidebar)).toHaveAccessibleName('Summarize · Short');
    const before = mock.prompts.length;
    await main(sidebar).click();
    await expect(questions(sidebar)).toHaveText(['Summarize · Short']);
    await settled(sidebar);
    await expect.poll(() => mock.prompts.length).toBeGreaterThan(before);
    expect(mock.prompts[before] === SHORT_PROMPT, 'Short again').toBe(true);

    // 5. The side panel closed and reopened: still Short, checked in the menu.
    await sidebar.close();
    sidebar = await openSidebarWindow(browser, id);
    await expect(main(sidebar)).toHaveAccessibleName('Summarize · Short');
    await expect(questions(sidebar)).toHaveText(['Summarize · Short']);
    await arrow(sidebar).click();
    await expect(checkedItems(sidebar)).toHaveText(['Short']);
    await expect(item(sidebar, 'Short')).toBeFocused();
    await screens(sidebar, 'T27-05-reopened-menu');
    await sidebar.keyboard.press('Escape');
    await expect(arrow(sidebar)).toBeFocused();
  });
});
