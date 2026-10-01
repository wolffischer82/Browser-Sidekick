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

// T10: the ask flow against the mock LLM. One pinned fixture page plus the
// current tab; the request carries both with delimiters (checked on the
// mock's request log by booleans only, never printing page text); the
// answer streams with Markdown and citations; citation [1] focuses the
// pinned page's tab; the eye removes the current tab; Stop keeps the partial
// answer; a 429 shows the error with Retry, which survives a reload and
// then resends; the LLM title appears; trimming shows its notice; switching
// sessions restores the history. Screens: test-results/screens/T10-*.png.

const KEY = 'sk-mock-chat-e2e-5c1d';
const ARTICLE = 'Night trains return to Europe | The Fixture Times';
const DASHBOARD = 'Fixture dashboard';
const TITLE = 'Night trains in Europe';

/** Words only one fixture page has, to find it in a request. */
const ARTICLE_MARK = 'Vienna to Amsterdam';
const DASHBOARD_MARK = 'Printer offline';
const PDF_MARK = 'Operators plan more cross-border connections';

const ANSWER = [
  'Night trains are coming back across Europe [1].',
  '',
  '- **Vienna to Amsterdam** runs three times a week [1]',
  '- The dashboard lists *12 open tickets* [2]',
  '',
  '```text',
  'Departure 21:04',
  'Arrival   08:47',
  '```',
  '',
  'A number without a source stays plain [7].',
  '<script>window.pwned = 1</script><img src="x" onerror="window.pwned = 2">',
].join('\n');

const LONG_PARAGRAPH =
  'Operators are adding sleeper carriages, redesigning timetables so trains pass busy junctions at night, and sharing rolling stock across borders. ';

const RATE_LIMIT = "The provider's rate limit or quota was reached.";
const TRIMMED = 'Some history or page text was left out to fit the context budget.';

interface ChromeApi {
  tabs: { query(q: object): Promise<{ url?: string }[]> };
  storage: {
    local: { get(k: string): Promise<Record<string, unknown>>; set(o: object): Promise<void> };
  };
}

const input = (page: Page) => page.getByRole('textbox', { name: 'Ask about these pages…' });
const currentRow = (page: Page) => page.locator('.tab-row[data-current]');
const pinRow = (page: Page, title: string) => page.locator('li.pin-row', { hasText: title });
const answers = (page: Page) => page.getByRole('article', { name: 'Answer' });
const questions = (page: Page) => page.getByRole('article', { name: 'Your question' });
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop' });
const titleButton = (page: Page) => page.getByTitle('Rename session');
const modelButton = (page: Page) => page.locator('#model-button');

interface ChatBody {
  model?: string;
  messages?: { role: string; content: string }[];
}

function chats(mock: MockLlm) {
  return mock.requests.filter((r) => r.path === '/v1/chat/completions');
}

function body(mock: MockLlm, index: number): ChatBody {
  return chats(mock).at(index)?.body ?? {};
}

function system(b: ChatBody): string {
  return b.messages?.find((m) => m.role === 'system')?.content ?? '';
}

async function ask(page: Page, question: string): Promise<void> {
  await input(page).fill(question);
  await input(page).press('Enter');
}

/** The URL of the active tab of the normal browser window. */
async function activeTabUrl(context: BrowserContext): Promise<string | undefined> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return worker.evaluate(async () => {
    const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
    const [tab] = await chrome.tabs.query({ active: true, windowType: 'normal' });
    return tab?.url;
  });
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

test.describe('chat', () => {
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

  test('ask with a pin and the current tab, cite, exclude, stop, retry, title, trim, restore', async () => {
    test.setTimeout(180_000);
    const profile = await newProfile();
    removeProfile = profile.remove;
    const browser = await launchWithGrantedOrigins(profile.dir, ['<all_urls>']);
    context = browser;
    const id = await extensionId(browser);

    const article = browser.pages()[0] ?? (await browser.newPage());
    await article.goto(server.url('article.html'));
    const sidebar = await openSidebarWindow(browser, id);

    await seedProvider(sidebar, mock);
    await sidebar.reload();
    await expect(input(sidebar)).toBeEnabled();
    await expect(modelButton(sidebar)).toHaveText('mock-large');

    // 1. One pinned page (the article) plus the current tab (the dashboard).
    await expect(currentRow(sidebar)).toContainText(ARTICLE);
    await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
    await expect(pinRow(sidebar, ARTICLE)).toHaveAttribute('data-status', 'ready');
    const dashboard = await browser.newPage();
    await dashboard.goto(server.url('non-article.html'));
    await dashboard.bringToFront();
    await expect(currentRow(sidebar)).toContainText(DASHBOARD);

    // 3. The answer streams in, with Stop while it streams.
    mock.script(
      { kind: 'stream', chunks: chunkText(ANSWER, 8), delayMs: 70 },
      { kind: 'stream', chunks: ['"Night trains ', 'in Europe."'] },
    );
    await ask(sidebar, 'What is new with night trains?');
    await expect(questions(sidebar)).toHaveText(['What is new with night trains?']);
    await expect(stopButton(sidebar)).toBeVisible();
    await expect(answers(sidebar).first()).toContainText('Night trains are coming back');
    await screen(sidebar, 'T10-01-streaming');
    await expect(stopButton(sidebar)).toHaveCount(0, { timeout: 20_000 });

    const first = answers(sidebar).first();
    await expect(first.locator('li')).toHaveCount(2);
    await expect(first.locator('pre code')).toContainText('Departure 21:04');
    await expect(first.locator('a.citation')).toHaveText(['[1]', '[1]', '[2]']);
    await expect(first).toContainText('stays plain [7].');
    await expect(first.getByRole('link', { name: `Source 2: ${DASHBOARD}` })).toHaveAttribute(
      'href',
      server.url('non-article.html'),
    );
    await expect(first).toContainText('Mock server · mock-large');

    // Injected script and onerror in model output don't run (real Chromium).
    expect(await sidebar.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
    await expect(sidebar.locator('.chat-log script, .chat-log img')).toHaveCount(0);

    // 2. The request carried both pages with delimiters, to the session's model.
    const firstBody = body(mock, 0);
    const firstSystem = system(firstBody);
    expect(firstBody.model).toBe('mock-large');
    expect(chats(mock)[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(firstSystem.includes('<<<PAGE 1>>>'), 'pin delimiter').toBe(true);
    expect(firstSystem.includes('<<<END PAGE 1>>>'), 'pin end delimiter').toBe(true);
    expect(firstSystem.includes('<<<PAGE 2>>>'), 'current tab delimiter').toBe(true);
    expect(firstSystem.includes('<<<END PAGE 2>>>'), 'current tab end delimiter').toBe(true);
    expect(firstSystem.includes('Source: current tab'), 'current tab label').toBe(true);
    expect(firstSystem.includes(ARTICLE_MARK), 'pinned page text').toBe(true);
    expect(firstSystem.includes(DASHBOARD_MARK), 'current tab text').toBe(true);
    expect(
      firstSystem.indexOf(ARTICLE_MARK) < firstSystem.indexOf(DASHBOARD_MARK),
      'pin before the current tab',
    ).toBe(true);

    // 7. The title is generated once, after the first answer.
    await expect(titleButton(sidebar)).toHaveText(TITLE);
    await expect.poll(() => chats(mock).length).toBe(2);
    expect(system(body(mock, 1)).includes('Write a title'), 'title request').toBe(true);
    expect(body(mock, 1).model).toBe('mock-large');
    await screens(sidebar, 'T10-02-answer');
    await sidebar.locator('.transcript').evaluate((el) => {
      el.scrollTop = 0;
    });
    await screen(sidebar, 'T10-06-title');

    // 4. Citation [1] focuses the pinned article's tab.
    expect(await activeTabUrl(browser)).toBe(server.url('non-article.html'));
    await first.locator('a.citation', { hasText: '[1]' }).first().click();
    await expect.poll(() => activeTabUrl(browser)).toBe(server.url('article.html'));
    await expect(pinRow(sidebar, ARTICLE)).toHaveAttribute('data-current', '');

    // 2. With the eye, the current tab is left out of the next request.
    await dashboard.bringToFront();
    await expect(currentRow(sidebar)).toContainText(DASHBOARD);
    await currentRow(sidebar).getByRole('button', { name: 'Exclude from questions' }).click();
    await expect(currentRow(sidebar)).toContainText('Not included in questions');

    // 5. Stop mid-stream keeps the partial answer, marked stopped.
    mock.script({
      kind: 'stream',
      chunks: chunkText(LONG_PARAGRAPH.repeat(6), 6),
      delayMs: 120,
    });
    await ask(sidebar, 'Which routes are new?');
    await expect(answers(sidebar).nth(1)).toContainText('Operators are adding');
    expect(chats(mock)).toHaveLength(3);
    const excluded = system(body(mock, 2));
    expect(excluded.includes(ARTICLE_MARK), 'pinned page still sent').toBe(true);
    expect(excluded.includes(DASHBOARD_MARK), 'excluded tab text absent').toBe(false);
    expect(excluded.includes('Source: current tab'), 'excluded tab label absent').toBe(false);
    expect(excluded.includes('<<<PAGE 2>>>'), 'no second page').toBe(false);
    await stopButton(sidebar).click();
    await expect(answers(sidebar).nth(1)).toContainText('Stopped');
    await expect(stopButton(sidebar)).toHaveCount(0);
    await expect(input(sidebar)).toBeFocused();
    await screen(sidebar, 'T10-03-stopped');
    const partial = (await answers(sidebar).nth(1).locator('.answer-body').innerText()).length;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(LONG_PARAGRAPH.length * 6);

    // Requests follow the session's model.
    await modelButton(sidebar).click();
    await sidebar
      .getByRole('listbox', { name: 'Model' })
      .getByRole('option', { name: 'mock-small' })
      .click();
    await expect(modelButton(sidebar)).toHaveText('mock-small');

    // 6. A 429 shows the mapped error with Retry.
    mock.script({
      kind: 'error',
      status: 429,
      body: { error: { message: 'Rate limit reached.', type: 'requests', code: 'rate_limit' } },
    });
    await ask(sidebar, 'Are tickets cheaper?');
    const alert = sidebar.getByRole('alert');
    await expect(alert).toContainText(RATE_LIMIT);
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    await screen(sidebar, 'T10-04-error-retry');
    expect(chats(mock)).toHaveLength(4);
    expect(body(mock, 3).model).toBe('mock-small');

    // The error and Retry are stored: they survive a reload of the sidebar.
    await sidebar.reload();
    await expect(titleButton(sidebar)).toHaveText(TITLE);
    await expect(questions(sidebar)).toHaveCount(3);
    await expect(sidebar.getByRole('alert')).toContainText(RATE_LIMIT);
    await expect(answers(sidebar).nth(1)).toContainText('Stopped');

    // Retry resends the same question; success clears the error.
    await sidebar.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await expect(answers(sidebar).nth(2)).toContainText(MOCK_REPLY);
    await expect(sidebar.getByRole('alert')).toHaveCount(0);
    await expect(answers(sidebar)).toHaveCount(3);
    expect(chats(mock)).toHaveLength(5);
    expect((body(mock, 4).messages ?? []).at(-1)).toEqual({
      role: 'user',
      content: 'Are tickets cheaper?',
    });
    await expect(questions(sidebar)).toHaveText([
      'What is new with night trains?',
      'Which routes are new?',
      'Are tickets cheaper?',
    ]);
    await expect(answers(sidebar).nth(2)).toContainText('Mock server · mock-small');
    await sidebar.reload();
    await expect(answers(sidebar)).toHaveCount(3);
    await expect(sidebar.getByRole('alert')).toHaveCount(0);

    // A long conversation scrolls, following the newest answer.
    for (const [i, question] of ['When do trains leave?', 'And when do they arrive?'].entries()) {
      mock.script({ kind: 'stream', chunks: chunkText(LONG_PARAGRAPH.repeat(5 + i), 40) });
      await ask(sidebar, question);
      await expect(answers(sidebar)).toHaveCount(4 + i);
      await expect(stopButton(sidebar)).toHaveCount(0);
    }
    const scroll = await sidebar
      .locator('.transcript')
      .evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
    expect(scroll.max).toBeGreaterThan(0);
    expect(scroll.max - scroll.top).toBeLessThan(48);
    await screen(sidebar, 'T10-07-long-scroll');

    // Trimming: with a small context budget the old history is dropped, with a notice.
    await sidebar.evaluate(async () => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      const { providers } = (await chrome.storage.local.get('providers')) as {
        providers: { contextBudget: number }[];
      };
      await chrome.storage.local.set({
        providers: providers.map((p) => ({ ...p, contextBudget: 1000 })),
      });
    });
    mock.script({ kind: 'stream', chunks: chunkText(LONG_PARAGRAPH.repeat(3), 40) });
    await ask(sidebar, 'Summarise the critics in one paragraph.');
    await expect(answers(sidebar).nth(5)).toContainText(TRIMMED);
    await expect(stopButton(sidebar)).toHaveCount(0);
    expect(chats(mock)).toHaveLength(8);
    const trimmed = body(mock, 7);
    expect(system(trimmed).includes('<<<PAGE 1>>>'), 'page still sent').toBe(true);
    const sent = (trimmed.messages ?? []).reduce((sum, m) => sum + m.content.length, 0);
    expect(sent).toBeLessThanOrEqual(4000);
    await screen(sidebar, 'T10-05-trimmed');

    // 8. Switch session and back: the history is restored.
    await sidebar.getByRole('button', { name: 'New session' }).click();
    await expect(titleButton(sidebar)).toHaveText('New session');
    await expect(questions(sidebar)).toHaveCount(0);
    await expect(sidebar.getByText('Pin pages to this session')).toBeVisible();
    await sidebar.getByRole('button', { name: 'Sessions' }).click();
    await sidebar.getByRole('button', { name: new RegExp(`^${TITLE}`) }).click();
    await expect(titleButton(sidebar)).toHaveText(TITLE);
    await expect(questions(sidebar)).toHaveCount(6);
    await expect(answers(sidebar)).toHaveCount(6);
    await expect(answers(sidebar).nth(1)).toContainText('Stopped');
    await expect(answers(sidebar).nth(5)).toContainText(TRIMMED);
    await expect(answers(sidebar).nth(3)).not.toContainText(TRIMMED);
    await expect(answers(sidebar).first().locator('a.citation')).toHaveCount(3);

    // Only the first answer asked for a title.
    const titleRequests = chats(mock).filter((r) =>
      system(r.body as ChatBody).includes('Write a title'),
    );
    expect(titleRequests).toHaveLength(1);
  });

  test('a PDF in the current tab is read in the sidebar and sent with the question', async () => {
    const profile = await newProfile();
    removeProfile = profile.remove;
    const browser = await launchWithGrantedOrigins(profile.dir, ['<all_urls>']);
    context = browser;
    const id = await extensionId(browser);
    const tab = browser.pages()[0] ?? (await browser.newPage());
    await tab.goto(server.url('pdf/text.pdf'));
    const sidebar = await openSidebarWindow(browser, id);
    await seedProvider(sidebar, mock);
    await sidebar.reload();
    await expect(input(sidebar)).toBeEnabled();
    await expect(currentRow(sidebar)).toContainText('Current tab');
    await expect(currentRow(sidebar).getByRole('button', { name: 'Pin to session' })).toBeVisible();

    await ask(sidebar, 'What does the PDF say?');
    await expect(answers(sidebar).first()).toContainText(MOCK_REPLY);
    await expect(answers(sidebar).first()).not.toContainText("couldn't be read");
    const sent = system(body(mock, 0));
    expect(sent.includes('<<<PAGE 1>>>'), 'current tab delimiter').toBe(true);
    expect(sent.includes('Source: current tab'), 'current tab label').toBe(true);
    expect(sent.includes(PDF_MARK), 'PDF text').toBe(true);

    // Nothing of the current tab is stored: the session has no pin.
    await expect(sidebar.locator('li.pin-row')).toHaveCount(0);
  });
});
