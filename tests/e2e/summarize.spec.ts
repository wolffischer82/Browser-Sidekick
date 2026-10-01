import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { chunkText, MOCK_MODELS, MOCK_REPLY, startMockLlm, type MockLlm } from '../mock-llm/server';
import { startFixtureServer, type FixtureServer } from './fixture-server';
import {
  extensionId,
  launchWithGrantedOrigins,
  newProfile,
  openSidebarWindow,
  screen,
  screens,
} from './extension';

// T11: Summarize against the mock LLM. The button is disabled with a tooltip
// while there is nothing to summarise; with one pinned fixture page plus the
// current tab the request carries both (checked on the mock's request log by
// booleans only, never printing page text) and the fixed prompt; the answer
// streams in under a "Summarize" message and, as the session's first answer,
// gets the generated title; with the eye, the current tab is left out.
// Screens: test-results/screens/T11-*.png.

const KEY = 'sk-mock-summarize-e2e-7a2f';
const ARTICLE = 'Night trains return to Europe | The Fixture Times';
const DASHBOARD = 'Fixture dashboard';
const TITLE = 'Night trains and tickets';

/** Words only one fixture page has, to find it in a request. */
const ARTICLE_MARK = 'Vienna to Amsterdam';
const DASHBOARD_MARK = 'Printer offline';

const SUMMARY = [
  '### Night trains return to Europe [1]',
  '',
  'Sleeper services are coming back, with a new **Vienna to Amsterdam** route [1].',
  '',
  '### Fixture dashboard [2]',
  '',
  'An internal dashboard with *12 open tickets* [2].',
  '',
  '### Overall',
  '',
  '- **Common themes:** both pages are about keeping a service running [1] [2].',
  '- **Disagreements:** none; the pages cover different subjects.',
].join('\n');

const NOTHING = 'Pin a page or open a readable tab to summarize.';
const BUSY = 'Wait for the answer to finish, or stop it.';

interface ChromeApi {
  storage: { local: { set(o: object): Promise<void> } };
}

interface ChatBody {
  model?: string;
  messages?: { role: string; content: string }[];
}

const input = (page: Page) => page.getByRole('textbox', { name: 'Ask about these pages…' });
const currentRow = (page: Page) => page.locator('.tab-row[data-current]');
const pinRow = (page: Page, title: string) => page.locator('li.pin-row', { hasText: title });
const answers = (page: Page) => page.getByRole('article', { name: 'Answer' });
const questions = (page: Page) => page.getByRole('article', { name: 'Your question' });
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop' });
const titleButton = (page: Page) => page.getByTitle('Rename session');
const summarize = (page: Page) => page.getByRole('button', { name: 'Summarize', exact: true });
const tooltip = (page: Page) => page.getByRole('tooltip');

function chats(mock: MockLlm) {
  return mock.requests.filter((r) => r.path === '/v1/chat/completions');
}

function body(mock: MockLlm, index: number): ChatBody {
  return chats(mock).at(index)?.body ?? {};
}

function system(b: ChatBody): string {
  return b.messages?.find((m) => m.role === 'system')?.content ?? '';
}

/** The last message of a request: the question the model is asked. */
function asked(b: ChatBody): string {
  return b.messages?.at(-1)?.content ?? '';
}

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

test.describe('summarize', () => {
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

  test('disabled with a tooltip, then a pin plus the current tab, the title, and the eye', async () => {
    test.setTimeout(120_000);
    const profile = await newProfile();
    removeProfile = profile.remove;
    const browser = await launchWithGrantedOrigins(profile.dir, ['<all_urls>']);
    context = browser;
    const id = await extensionId(browser);

    // An empty session, and a current tab that can't be read (a blank tab).
    const article = browser.pages()[0] ?? (await browser.newPage());
    const sidebar = await openSidebarWindow(browser, id);
    await seedProvider(sidebar, mock);
    await sidebar.reload();
    await expect(input(sidebar)).toBeEnabled();
    await expect(currentRow(sidebar)).toContainText("This page can't be read");
    await expect(sidebar.locator('li.pin-row')).toHaveCount(0);

    // 1. Nothing to summarise: the button is disabled and says why.
    await expect(summarize(sidebar)).toHaveAttribute('aria-disabled', 'true');
    await expect(tooltip(sidebar)).toBeHidden();
    await summarize(sidebar).hover();
    await expect(tooltip(sidebar)).toBeVisible();
    await expect(tooltip(sidebar)).toHaveText(NOTHING);
    await screens(sidebar, 'T11-01-disabled-tooltip');
    // The tooltip stays inside the sidebar.
    const box = await tooltip(sidebar).boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 400).toBe(true);
    // A click does nothing (forced: Playwright waits on `aria-disabled` otherwise).
    await summarize(sidebar).click({ force: true });
    await sidebar.mouse.move(200, 100);
    await expect(tooltip(sidebar)).toBeHidden();
    // The keyboard reaches the button and shows the same tooltip.
    await input(sidebar).focus();
    await sidebar.keyboard.press('Shift+Tab');
    await expect(summarize(sidebar)).toBeFocused();
    await expect(tooltip(sidebar)).toBeVisible();
    await sidebar.keyboard.press('Enter');
    await sidebar.keyboard.press('Tab');
    await expect(input(sidebar)).toBeFocused();
    await expect(tooltip(sidebar)).toBeHidden();
    await expect(questions(sidebar)).toHaveCount(0);
    expect(chats(mock)).toHaveLength(0);

    // 2. One pinned page (the article) plus the current tab (the dashboard).
    await article.goto(server.url('article.html'));
    await expect(currentRow(sidebar)).toContainText(ARTICLE);
    // A readable current tab alone is enough.
    await expect(summarize(sidebar)).toHaveAttribute('aria-disabled', 'false');
    await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
    await expect(pinRow(sidebar, ARTICLE)).toHaveAttribute('data-status', 'ready');
    const dashboard = await browser.newPage();
    await dashboard.goto(server.url('non-article.html'));
    await dashboard.bringToFront();
    await expect(currentRow(sidebar)).toContainText(DASHBOARD);
    await expect(summarize(sidebar)).toHaveAttribute('aria-disabled', 'false');
    await expect(tooltip(sidebar)).toHaveCount(0);

    // 3. Summarize is the session's first action: the answer streams in.
    mock.script(
      { kind: 'stream', chunks: chunkText(SUMMARY, 8), delayMs: 60 },
      { kind: 'stream', chunks: ['"Night trains ', 'and tickets."'] },
    );
    await summarize(sidebar).click();
    await expect(questions(sidebar)).toHaveText(['Summarize']);
    await expect(stopButton(sidebar)).toBeVisible();
    await expect(answers(sidebar).first()).toContainText('Sleeper services');
    // While it streams, the button is disabled and says so.
    await expect(summarize(sidebar)).toHaveAttribute('aria-disabled', 'true');
    await summarize(sidebar).hover();
    await expect(tooltip(sidebar)).toHaveText(BUSY);
    await screen(sidebar, 'T11-02-streaming');
    await sidebar.mouse.move(200, 100);
    await expect(stopButton(sidebar)).toHaveCount(0, { timeout: 20_000 });
    await expect(summarize(sidebar)).toHaveAttribute('aria-disabled', 'false');

    const first = answers(sidebar).first();
    await expect(first.locator('h3')).toHaveCount(3);
    await expect(first.locator('li')).toHaveCount(2);
    await expect(first.locator('button.citation')).toHaveText([
      '[1]',
      '[1]',
      '[2]',
      '[2]',
      '[1]',
      '[2]',
    ]);
    await expect(
      first.getByRole('button', { name: `Source 2: ${DASHBOARD}` }).first(),
    ).toBeVisible();
    await expect(first).toContainText('Mock server · mock-large');

    // The request carried both pages, pin first, and the fixed prompt.
    const firstBody = body(mock, 0);
    const firstSystem = system(firstBody);
    expect(firstBody.model).toBe('mock-large');
    expect(firstSystem.includes('<<<PAGE 1>>>'), 'pin delimiter').toBe(true);
    expect(firstSystem.includes('<<<END PAGE 1>>>'), 'pin end delimiter').toBe(true);
    expect(firstSystem.includes('<<<PAGE 2>>>'), 'current tab delimiter').toBe(true);
    expect(firstSystem.includes('<<<END PAGE 2>>>'), 'current tab end delimiter').toBe(true);
    expect(firstSystem.includes('<<<PAGE 3>>>'), 'no third page').toBe(false);
    expect(firstSystem.includes('Source: pinned page'), 'pin label').toBe(true);
    expect(firstSystem.includes('Source: current tab'), 'current tab label').toBe(true);
    expect(firstSystem.includes(ARTICLE_MARK), 'pinned page text').toBe(true);
    expect(firstSystem.includes(DASHBOARD_MARK), 'current tab text').toBe(true);
    expect(
      firstSystem.indexOf(ARTICLE_MARK) < firstSystem.indexOf(DASHBOARD_MARK),
      'pin before the current tab',
    ).toBe(true);
    const prompt = asked(firstBody);
    expect(prompt.startsWith('Summarize the pages provided.'), 'fixed prompt').toBe(true);
    expect(prompt.includes('each page'), 'per-page summary').toBe(true);
    expect(prompt.includes('overall summary'), 'overall summary').toBe(true);
    expect(prompt.includes('Answer in English.'), 'UI language').toBe(true);
    expect(firstBody.messages).toHaveLength(2);
    // The prompt isn't shown; the transcript says "Summarize".
    await expect(sidebar.getByText('Summarize the pages provided')).toHaveCount(0);

    // The summary is the first answer, so the session gets its generated title.
    await expect(titleButton(sidebar)).toHaveText(TITLE);
    await expect.poll(() => chats(mock).length).toBe(2);
    expect(system(body(mock, 1)).includes('Write a title'), 'title request').toBe(true);
    await screens(sidebar, 'T11-03-summary');
    await sidebar.locator('.transcript').evaluate((el) => {
      el.scrollTop = 0;
    });
    await screens(sidebar, 'T11-04-first-action-title');

    // A citation of the summary leads to its page.
    await first.locator('button.citation', { hasText: '[1]' }).first().click();
    await expect(pinRow(sidebar, ARTICLE)).toHaveAttribute('data-current', '');

    // 4. With the eye, the current tab is left out of the next summary.
    await dashboard.bringToFront();
    await expect(currentRow(sidebar)).toContainText(DASHBOARD);
    await currentRow(sidebar).getByRole('button', { name: 'Exclude from questions' }).click();
    await expect(currentRow(sidebar)).toContainText('Not included in questions');
    await expect(summarize(sidebar)).toHaveAttribute('aria-disabled', 'false');
    await summarize(sidebar).click();
    await expect(answers(sidebar).nth(1)).toContainText(MOCK_REPLY);
    await expect(stopButton(sidebar)).toHaveCount(0);
    await expect(questions(sidebar)).toHaveText(['Summarize', 'Summarize']);
    expect(chats(mock)).toHaveLength(3);
    const excluded = system(body(mock, 2));
    expect(excluded.includes(ARTICLE_MARK), 'pinned page still sent').toBe(true);
    expect(excluded.includes(DASHBOARD_MARK), 'excluded tab text absent').toBe(false);
    expect(excluded.includes('Source: current tab'), 'excluded tab label absent').toBe(false);
    expect(excluded.includes('<<<PAGE 2>>>'), 'no second page').toBe(false);
    expect(asked(body(mock, 2)) === prompt, 'the same prompt').toBe(true);
    await screen(sidebar, 'T11-05-current-tab-excluded');

    // The summaries are stored: they are there after a reload, as "Summarize".
    await sidebar.reload();
    await expect(titleButton(sidebar)).toHaveText(TITLE);
    await expect(questions(sidebar)).toHaveText(['Summarize', 'Summarize']);
    await expect(answers(sidebar)).toHaveCount(2);
    await expect(answers(sidebar).first().locator('button.citation')).toHaveCount(6);

    // 5. A new, empty session on an excluded tab: disabled again, until the eye includes it.
    await currentRow(sidebar).getByRole('button', { name: 'Exclude from questions' }).click();
    await sidebar.getByRole('button', { name: 'New session' }).click();
    await expect(titleButton(sidebar)).toHaveText('New session');
    await expect(sidebar.locator('li.pin-row')).toHaveCount(0);
    await expect(currentRow(sidebar)).toContainText('Not included in questions');
    await expect(summarize(sidebar)).toHaveAttribute('aria-disabled', 'true');
    await summarize(sidebar).hover();
    await expect(tooltip(sidebar)).toHaveText(NOTHING);
    await screen(sidebar, 'T11-06-empty-session-disabled');
    await summarize(sidebar).click({ force: true });
    await sidebar.mouse.move(200, 100);
    await currentRow(sidebar).getByRole('button', { name: 'Include in questions' }).click();
    await expect(summarize(sidebar)).toHaveAttribute('aria-disabled', 'false');

    // Only the first answer asked for a title, and the disabled clicks sent nothing.
    expect(chats(mock)).toHaveLength(3);
    const titleRequests = chats(mock).filter((r) =>
      system(r.body as ChatBody).includes('Write a title'),
    );
    expect(titleRequests).toHaveLength(1);
  });
});
