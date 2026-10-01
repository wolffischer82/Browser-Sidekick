import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MOCK_REPLY, startMockLlm, type MockLlm } from '../mock-llm/server';
import {
  extensionId,
  launchWithGrantedOrigins,
  newProfile,
  openSidebar,
  screen,
  screens,
} from './extension';

// T16 (specs/thinking-levels.md 4.5): the reasoning block against the mock
// LLM. The reply streams its reasoning before the answer and is held by the
// mock in between, so each state is looked at without timing: "Thinking…"
// while only reasoning has arrived, opened with the keyboard and growing
// live with the transcript following it, "Reasoning" once the answer text
// arrives; collapsed again after a reload and after a session switch, and
// expandable again; markup injected into the reasoning doesn't run; an
// answer without reasoning has no block; a stopped answer keeps its block.
// Screens: test-results/screens/T16-*.png.

const KEY = 'sk-mock-reasoning-e2e-5d1c';
const MOCK_ORIGIN = 'http://127.0.0.1/*';
const TITLE = 'Night train plans';

const FIRST_THOUGHTS = [
  'The user asks which route to take. ',
  'I should **compare** both options first.\n\n',
];
// Long enough to overflow the sidebar, with markup that must stay inert.
const MORE_THOUGHTS = [
  ...Array.from(
    { length: 14 },
    (_, i) =>
      `${String(i + 1)}. Step ${String(i + 1)}: weigh the travel time against the price of this leg, and note what the page [1] says about it.\n`,
  ),
  '\n<script>window.pwned = 1</script>\n\n',
  '<img src="x" onerror="window.pwned = 2">\n\n',
  'So the `Vienna` route wins. Last thought.',
];
const ANSWER = ['Take the **Vienna** route: ', 'it is faster ', 'and cheaper.'];

const input = (page: Page) => page.getByRole('textbox', { name: 'Ask about these pages…' });
const title = (page: Page) => page.getByTitle('Rename session');
const answers = (page: Page) => page.getByRole('article', { name: 'Answer' });
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop' });
const toggles = (page: Page) => page.locator('.reasoning-toggle');
const bodies = (page: Page) => page.locator('.reasoning-body');
const transcript = (page: Page) => page.locator('.transcript');

async function ask(page: Page, question: string): Promise<void> {
  await input(page).fill(question);
  await input(page).press('Enter');
}

/** How far the transcript is from its end, in pixels. */
const fromEnd = (page: Page) =>
  transcript(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

async function seedProvider(page: Page, mock: MockLlm): Promise<void> {
  await page.evaluate(
    async ({ baseUrl, key }) => {
      const api = (
        globalThis as unknown as {
          chrome: { storage: { local: { set(o: object): Promise<void> } } };
        }
      ).chrome;
      await api.storage.local.set({
        providers: [
          {
            id: 'mock',
            kind: 'openai-compatible',
            label: 'Mock server',
            baseUrl,
            apiKey: key,
            defaultModel: 'mock-large',
            contextBudget: 100_000,
            cachedModels: ['mock-large', 'mock-small'],
            hasAccess: true,
          },
        ],
        defaultProviderId: 'mock',
      });
    },
    { baseUrl: mock.baseUrl, key: KEY },
  );
  await page.reload();
  await expect(input(page)).toBeEnabled();
}

test('reasoning block: Thinking… then Reasoning, expand, reopen, stop', async () => {
  test.setTimeout(120_000);
  const profile = await newProfile();
  let mock: MockLlm | undefined;
  let context: BrowserContext | undefined;
  try {
    mock = await startMockLlm({ apiKey: KEY });
    context = await launchWithGrantedOrigins(profile.dir, [MOCK_ORIGIN]);
    const page = await openSidebar(context, await extensionId(context));
    await seedProvider(page, mock);

    // The reply: reasoning first (held after its start, and again before the answer).
    mock.script(
      {
        kind: 'stream',
        reasoning: [...FIRST_THOUGHTS, ...MORE_THOUGHTS],
        chunks: ANSWER,
        holdAt: [FIRST_THOUGHTS.length, FIRST_THOUGHTS.length + MORE_THOUGHTS.length],
      },
      { kind: 'stream', chunks: [TITLE] },
    );
    await ask(page, 'Which route should I take?');

    // Only reasoning has arrived: the row reads "Thinking…" and is collapsed.
    const toggle = toggles(page).first();
    await expect(toggle).toHaveText('Thinking…');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggles(page)).toHaveCount(1);
    await expect(bodies(page).first()).toBeHidden();
    await expect(page.locator('.chat-log')).not.toContainText('compare');
    await expect(stopButton(page)).toBeVisible();
    await screens(page, 'T16-01-thinking-collapsed');

    // A real button: open it with Enter, close it with Space, open it again.
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const body = bodies(page).first();
    await expect(body).toBeVisible();
    await expect(body).toContainText('The user asks which route to take.');
    await expect(body.locator('strong')).toHaveText('compare');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(body).toBeVisible();
    await expect(toggle).toHaveText('Thinking…');
    await screens(page, 'T16-02-thinking-open');

    // More reasoning arrives: the open block grows live and the transcript follows it.
    expect(await fromEnd(page)).toBeLessThan(2);
    mock.release();
    await expect(body).toContainText('Last thought.');
    await expect(body.locator('li')).toHaveCount(14);
    await expect(toggle).toHaveText('Thinking…');
    expect(
      await transcript(page).evaluate((el) => el.scrollHeight > el.clientHeight),
      'the reasoning overflows the transcript',
    ).toBe(true);
    await expect.poll(() => fromEnd(page)).toBeLessThan(2);
    await screen(page, 'T16-03-thinking-open-growing');

    // The answer text arrives: the row reads "Reasoning" and the block stays open.
    mock.release();
    await expect(answers(page).first()).toContainText('it is faster and cheaper.');
    await expect(stopButton(page)).toHaveCount(0);
    await expect(title(page)).toHaveText(TITLE);
    await expect(toggle).toHaveText('Reasoning');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggles(page)).toHaveCount(1);
    await expect(body).toContainText('Last thought.');
    await expect.poll(() => fromEnd(page)).toBeLessThan(2);
    await screens(page, 'T16-04-answered-open');

    // Injected script and onerror in the reasoning don't run, and nothing loads.
    expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
    await expect(page.locator('.chat-log script, .chat-log img')).toHaveCount(0);
    // No citation buttons in the reasoning: "[1]" stays text.
    await expect(body).toContainText('what the page [1] says');
    await expect(body.locator('button')).toHaveCount(0);
    // The answer text is below the block and doesn't contain the reasoning.
    const answerText = answers(page).first().locator('.answer-body:not(.reasoning-body)');
    await expect(answerText).toHaveText('Take the Vienna route: it is faster and cheaper.');
    const bodyBox = await body.boundingBox();
    const answerBox = await answerText.boundingBox();
    expect((answerBox?.y ?? 0) >= (bodyBox?.y ?? 0) + (bodyBox?.height ?? 0)).toBe(true);

    // Collapsed: the row above the answer.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toBeHidden();
    await expect(answerText).toBeVisible();
    await screens(page, 'T16-05-answered-collapsed');

    // Opening a long block doesn't jump to its end: the row stays where it was.
    const before = await toggle.boundingBox();
    await toggle.click();
    await expect(body).toBeVisible();
    await expect(toggle).toBeInViewport();
    expect((await toggle.boundingBox())?.y).toBe(before?.y);
    await toggle.click();

    // The reasoning was neither sent on nor part of the title request.
    const sent = JSON.stringify(mock.requests.map((r) => r.body));
    expect(sent.includes('compare'), 'reasoning in a request').toBe(false);
    expect(sent.includes('Last thought'), 'reasoning in a request').toBe(false);

    // Reopened: collapsed again, and it expands again from the stored answer.
    await page.reload();
    await expect(title(page)).toHaveText(TITLE);
    const reopened = toggles(page).first();
    await expect(reopened).toHaveText('Reasoning');
    await expect(reopened).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.chat-log')).not.toContainText('compare');
    await reopened.click();
    await expect(reopened).toHaveAttribute('aria-expanded', 'true');
    await expect(bodies(page).first()).toContainText('The user asks which route to take.');
    await expect(bodies(page).first()).toContainText('Last thought.');
    await expect(bodies(page).first().locator('li')).toHaveCount(14);
    expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
    await expect(page.locator('.chat-log script, .chat-log img')).toHaveCount(0);
    await transcript(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    await screens(page, 'T16-06-reopened-expanded');

    // A narrow sidebar: the open block wraps and nothing scrolls sideways.
    await page.setViewportSize({ width: 320, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    expect(
      await transcript(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
      'the transcript does not scroll sideways',
    ).toBe(true);
    await screens(page, 'T16-07-narrow-320-expanded');
    await page.setViewportSize({ width: 400, height: 720 });

    // Another session and back: collapsed again.
    await page.getByRole('button', { name: 'New session' }).click();
    await expect(title(page)).toHaveText('New session');
    await expect(toggles(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Sessions' }).click();
    await page.getByRole('button', { name: new RegExp(`^${TITLE}`) }).click();
    await expect(title(page)).toHaveText(TITLE);
    await expect(toggles(page).first()).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.chat-log')).not.toContainText('compare');

    // An answer without reasoning has no block.
    await ask(page, 'And without reasoning?');
    await expect(answers(page).nth(1)).toContainText(MOCK_REPLY);
    await expect(stopButton(page)).toHaveCount(0);
    await expect(toggles(page)).toHaveCount(1);
    await expect(answers(page).nth(1).locator('.reasoning')).toHaveCount(0);

    // Stopped while only reasoning had arrived: the block stays, reading "Reasoning".
    mock.script({
      kind: 'stream',
      reasoning: ['Weighing the night train against the day train.'],
      chunks: ['Never sent.'],
      holdAt: [1],
    });
    await ask(page, 'Night or day?');
    const third = answers(page).nth(2);
    await expect(third.locator('.reasoning-toggle')).toHaveText('Thinking…');
    await stopButton(page).click();
    await expect(third).toContainText('Stopped');
    await expect(third.locator('.reasoning-toggle')).toHaveText('Reasoning');
    await expect(third.locator('.reasoning-toggle')).toHaveAttribute('aria-expanded', 'false');
    await third.locator('.reasoning-toggle').click();
    await expect(third.locator('.reasoning-body')).toContainText('Weighing the night train');
    await expect(third).not.toContainText('Never sent.');
    await screens(page, 'T16-08-stopped-reasoning-only');
  } finally {
    await context?.close();
    await mock?.close();
    await profile.remove();
  }
});
