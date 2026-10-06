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

// T18 (specs/redesign.md 5.1, 5.3, 5.4): the header, the composer and the
// transcript against the mock LLM. Without a provider the card is faded
// with its hint and Send is disabled; with one, the header shows the pin
// count and last activity; both menus open upward from the composer, by
// mouse and by keyboard, and change the session's model and level, which
// the request carries; Send asks like Enter and is disabled while the
// answer streams; citations show numbers only; Summarize streams and is
// stopped. Each state is captured at 400 and 320 px, light and dark.
// Screens: test-results/screens/T18-*.png.

const KEY = 'sk-mock-composer-e2e-71af';
const ARTICLE = 'Night trains return to Europe | The Fixture Times';
const HINT = 'Enter to send · Shift+Enter for a new line';
const NO_PROVIDER = 'Add a provider in settings to ask questions.';
const TOOLBAR = [
  '#model-button',
  '#thinking-button',
  '#new-session-button',
  '#summarize-button',
  '#send-button',
];

interface ChromeApi {
  storage: { local: { set(o: object): Promise<void> } };
}

interface ChatBody {
  model?: string;
  reasoning_effort?: string;
  messages?: { role: string; content: string }[];
}

const input = (page: Page) => page.getByRole('textbox', { name: 'Ask about these pages…' });
const send = (page: Page) => page.getByRole('button', { name: 'Send', exact: true });
const summarize = (page: Page) => page.getByRole('button', { name: 'Summarize', exact: true });
const modelButton = (page: Page) => page.locator('#model-button');
const thinkingButton = (page: Page) => page.locator('#thinking-button');
const modelList = (page: Page) => page.getByRole('listbox', { name: 'Model' });
const levelList = (page: Page) => page.getByRole('listbox', { name: 'Thinking level' });
const answers = (page: Page) => page.getByRole('article', { name: 'Answer' });
const questions = (page: Page) => page.getByRole('article', { name: 'Your question' });
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop' });
const subtitle = (page: Page) => page.locator('.header-subtitle');
const currentRow = (page: Page) => page.locator('.tab-row[data-current]');
const pinRow = (page: Page, title: string) => page.locator('li.pin-row', { hasText: title });

function chats(mock: MockLlm): ChatBody[] {
  return mock.requests
    .filter((r) => r.path === '/v1/chat/completions')
    .map((r) => (r.body ?? {}) as ChatBody);
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

async function box(page: Page, selector: string) {
  const rect = await page.locator(selector).first().boundingBox();
  if (!rect) throw new Error(`${selector} has no box`);
  return rect;
}

/** The toolbar's visible controls lie on one line inside the panel; nothing scrolls sideways. */
async function toolbarFits(page: Page, width: number): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
  const shown: string[] = [];
  for (const selector of TOOLBAR) {
    if ((await page.locator(selector).count()) > 0) shown.push(selector);
  }
  const first = await box(page, shown[0] ?? '');
  for (const selector of shown) {
    const rect = await box(page, selector);
    expect(rect.x, selector).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width, selector).toBeLessThanOrEqual(width);
    expect(
      Math.abs(rect.y + rect.height / 2 - (first.y + first.height / 2)),
      selector,
    ).toBeLessThan(2);
  }
}

/** An open list lies above its button and inside the panel. */
async function opensUpward(page: Page, list: string, button: string, width: number) {
  const l = await box(page, list);
  const b = await box(page, button);
  expect(l.y).toBeGreaterThanOrEqual(0);
  expect(l.y + l.height).toBeLessThanOrEqual(b.y);
  expect(l.x).toBeGreaterThanOrEqual(0);
  expect(l.x + l.width).toBeLessThanOrEqual(width);
  // Aligned to the button's left edge unless that would leave the panel.
  if (b.x + l.width <= width - 8) expect(Math.abs(l.x - b.x)).toBeLessThan(1);
}

/** Screens at 400 and 320 px, light and dark, checking the toolbar at both widths. */
async function bothWidths(
  page: Page,
  name: string,
  check?: (width: number) => Promise<void>,
): Promise<void> {
  for (const width of [400, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await toolbarFits(page, width);
    await check?.(width);
    await screens(page, `${name}-${String(width)}`);
  }
  await page.setViewportSize({ width: 400, height: 720 });
}

test.describe('composer', () => {
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

  test('ask with Send, both menus from the composer, citations, Summarize and Stop', async () => {
    test.setTimeout(180_000);
    const profile = await newProfile();
    removeProfile = profile.remove;
    const browser = await launchWithGrantedOrigins(profile.dir, ['<all_urls>']);
    context = browser;
    const id = await extensionId(browser);
    const article = browser.pages()[0] ?? (await browser.newPage());
    await article.goto(server.url('article.html'));
    const sidebar = await openSidebarWindow(browser, id);

    // 1. No provider: the card is faded with the hint and its link; Send is disabled.
    await expect(subtitle(sidebar)).toHaveText('No pins yet');
    await expect(input(sidebar)).toBeDisabled();
    await expect(send(sidebar)).toBeDisabled();
    await expect(sidebar.locator('#composer-hint')).toContainText(NO_PROVIDER);
    await expect(sidebar.getByText(HINT)).toHaveCount(0);
    // The card's contents are faded; New session isn't (O4, T21).
    await expect(input(sidebar)).toHaveCSS('opacity', '0.7');
    await expect(sidebar.locator('#new-session-button')).toHaveCSS('opacity', '1');
    await expect(modelButton(sidebar)).toHaveCount(0);
    await bothWidths(sidebar, 'T18-01-no-provider');

    // 2. Idle with a provider: the keyboard hint, Send disabled until there is a question.
    await seedProvider(sidebar, mock);
    await sidebar.reload();
    await expect(input(sidebar)).toBeEnabled();
    await expect(sidebar.getByText(HINT)).toBeVisible();
    await expect(send(sidebar)).toBeDisabled();
    await expect(modelButton(sidebar)).toHaveText('mock-large');
    await expect(thinkingButton(sidebar)).toHaveText('Default');
    await expect(thinkingButton(sidebar)).toHaveAccessibleName('Thinking level: Default');
    await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
    await expect(pinRow(sidebar, ARTICLE)).toHaveAttribute('data-status', 'ready');
    await expect(subtitle(sidebar)).toHaveText('1 pin · active now');
    // Header buttons are 36 px; the subtitle isn't part of the rename button's name.
    expect((await box(sidebar, '#settings-button')).width).toBe(36);
    // The first pin set the fallback title (D11).
    await expect(sidebar.getByTitle('Rename session')).toHaveAccessibleName(
      `Session title: ${ARTICLE}`,
    );
    await bothWidths(sidebar, 'T18-02-idle', async (width) => {
      // Below 360 px Summarize shows its icon only, its name kept.
      await expect(sidebar.locator('.summarize-label')).toHaveCSS(
        'position',
        width < 360 ? 'absolute' : 'static',
      );
      await expect(summarize(sidebar)).toHaveAccessibleName('Summarize');
    });

    // 3. The model menu by mouse: it opens upward and changes the model.
    await modelButton(sidebar).click();
    await expect(modelList(sidebar)).toBeVisible();
    await bothWidths(sidebar, 'T18-03-model-menu-open', (width) =>
      opensUpward(sidebar, '.model-list', '#model-button', width),
    );
    await modelList(sidebar).getByRole('option', { name: 'mock-small' }).click();
    await expect(modelButton(sidebar)).toHaveText('mock-small');
    await expect(modelList(sidebar)).toHaveCount(0);
    await expect(modelButton(sidebar)).toBeFocused();

    // 4. The thinking menu by keyboard: arrows open it and move, Enter chooses.
    await thinkingButton(sidebar).focus();
    await sidebar.keyboard.press('ArrowDown');
    await expect(levelList(sidebar)).toBeVisible();
    await expect(levelList(sidebar).getByRole('option', { name: 'Default' })).toBeFocused();
    await sidebar.keyboard.press('End');
    await expect(levelList(sidebar).getByRole('option', { name: 'High' })).toBeFocused();
    await bothWidths(sidebar, 'T18-04-thinking-menu-open', (width) =>
      opensUpward(sidebar, '.thinking-list', '#thinking-button', width),
    );
    await sidebar.keyboard.press('Enter');
    await expect(thinkingButton(sidebar)).toHaveText('High');
    await expect(thinkingButton(sidebar)).toHaveAccessibleName('Thinking level: High');
    await expect(thinkingButton(sidebar)).toBeFocused();
    // Escape closes a list without a change.
    await sidebar.keyboard.press('ArrowDown');
    await expect(levelList(sidebar).getByRole('option', { name: 'High' })).toBeFocused();
    await sidebar.keyboard.press('Escape');
    await expect(levelList(sidebar)).toHaveCount(0);
    await expect(thinkingButton(sidebar)).toHaveText('High');

    // 5. Ask with Send; it is disabled while the answer streams, and Enter doesn't send.
    mock.script(
      {
        kind: 'stream',
        chunks: ['Night trains are back [1]. ', 'Sleeper carriages are planned [1].'],
        holdAt: [1],
      },
      { kind: 'stream', chunks: ['Night trains'] },
    );
    // Focus shows on the card around the input, not on the input itself.
    await input(sidebar).click();
    await expect(sidebar.locator('.composer-card')).toHaveCSS('outline-style', 'solid');
    await expect(sidebar.locator('.composer-card')).toHaveCSS('outline-width', '2px');
    await expect(input(sidebar)).toHaveCSS('outline-style', 'none');
    await summarize(sidebar).focus();
    await expect(sidebar.locator('.composer-card')).toHaveCSS('outline-style', 'none');
    await input(sidebar).fill('What is new with night trains?');
    await expect(send(sidebar)).toBeEnabled();
    await send(sidebar).click();
    await expect(questions(sidebar)).toHaveText(['What is new with night trains?']);
    await expect(input(sidebar)).toHaveValue('');
    await expect(input(sidebar)).toBeFocused();
    await expect(answers(sidebar).first()).toContainText('Night trains are back');
    await expect(stopButton(sidebar)).toBeVisible();
    await input(sidebar).fill('A second question');
    await expect(send(sidebar)).toBeDisabled();
    await input(sidebar).press('Enter');
    await expect(questions(sidebar)).toHaveCount(1);
    await bothWidths(sidebar, 'T18-05-streaming');
    expect(chats(mock)).toHaveLength(1);
    expect(chats(mock)[0]?.model).toBe('mock-small');
    expect(chats(mock)[0]?.reasoning_effort).toBe('high');

    // 6. The answer: citations show numbers only, keep their names, and open the page.
    mock.release();
    await expect(stopButton(sidebar)).toHaveCount(0);
    const first = answers(sidebar).first();
    await expect(first.locator('button.citation')).toHaveText(['1', '1']);
    await expect(first.getByRole('button', { name: `Source 1: ${ARTICLE}` })).toHaveCount(2);
    await expect(first.locator('.answer-body')).not.toContainText('[1]');
    // The full stop after a chip sits flush against it (Main.dc.html).
    const gap = await first
      .locator('button.citation')
      .first()
      .evaluate((chip) => {
        const after = chip.nextSibling;
        if (!after || after.nodeType !== Node.TEXT_NODE) return null;
        const range = document.createRange();
        range.setStart(after, 0);
        range.setEnd(after, 1);
        return range.getBoundingClientRect().left - chip.getBoundingClientRect().right;
      });
    expect(gap).not.toBeNull();
    expect(Math.abs(gap ?? 99)).toBeLessThan(0.5);
    await expect(first).toContainText('Mock server · mock-small');
    await expect(send(sidebar)).toBeEnabled();
    await expect(subtitle(sidebar)).toHaveText('1 pin · active now');
    await bothWidths(sidebar, 'T18-06-answer-citations');
    const tabs = browser.pages().length;
    await first.locator('button.citation').first().click();
    await expect.poll(() => browser.pages().length).toBe(tabs);
    await input(sidebar).fill('');

    // 7. Summarize streams; Stop keeps the partial answer.
    mock.script({
      kind: 'stream',
      chunks: ['## Night trains\n\n', 'Sleepers return [1].'],
      holdAt: [1],
    });
    await summarize(sidebar).click();
    await expect(questions(sidebar).last()).toHaveText('Summarize');
    await expect(answers(sidebar).last()).toContainText('Night trains');
    await expect(summarize(sidebar)).toHaveAttribute('aria-disabled', 'true');
    await stopButton(sidebar).click();
    await expect(stopButton(sidebar)).toHaveCount(0);
    await expect(answers(sidebar).last()).toContainText('Stopped');
    await expect(summarize(sidebar)).toHaveAttribute('aria-disabled', 'false');
    await expect(input(sidebar)).toBeFocused();
    mock.release();
  });
});
