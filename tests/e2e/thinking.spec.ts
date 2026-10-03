import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  MOCK_PLAIN_MODEL,
  MOCK_REJECTING_MODEL,
  MOCK_REPLY,
  MOCK_THINKING_MODEL,
  MOCK_THINKING_MODELS,
  startMockLlm,
  type MockLlm,
} from '../mock-llm/server';
import {
  extensionId,
  launchWithGrantedOrigins,
  newProfile,
  openSidebar,
  screen,
  screens,
} from './extension';

// T15 (specs/thinking-levels.md): the thinking-level control in the session
// composer against the mock LLM. The provider is added through the settings
// form, so the model list's `supported_parameters` decide where the control
// shows. Set High and ask: the mock received `reasoning_effort: "high"`; a
// new session starts at Default; the level survives a session switch and a
// reload; a model that rejects the level shows the error with Retry, and
// after Default the Retry succeeds; the control is hidden for a model known
// not to take a level and keeps the stored one. The requests are checked on
// the mock's record of `reasoning_effort` only.
// Screens: test-results/screens/T15-*.png.

const KEY = 'sk-mock-thinking-e2e-9b2e';
const MOCK_ORIGIN = 'http://127.0.0.1/*';
const LONG_MODEL = 'mock-provider/very-long-model-name-for-narrow-sidebars-2026-10-01';
const REJECTED =
  "This model doesn't accept a thinking level. Set thinking to Default and try again.";

const field = (page: Page, name: string) => page.getByLabel(name, { exact: true });
const input = (page: Page) => page.getByRole('textbox', { name: 'Ask about these pages…' });
const title = (page: Page) => page.getByTitle('Rename session');
const modelButton = (page: Page) => page.locator('#model-button');
const control = (page: Page) => page.locator('#thinking-button');
const levels = (page: Page) => page.getByRole('listbox', { name: 'Thinking level' });
const answers = (page: Page) => page.getByRole('article', { name: 'Answer' });
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop' });

async function ask(page: Page, question: string): Promise<void> {
  await input(page).fill(question);
  await input(page).press('Enter');
}

async function chooseLevel(page: Page, name: string): Promise<void> {
  await control(page).click();
  await levels(page).getByRole('option', { name, exact: true }).click();
  await expect(control(page)).toHaveText(name);
}

async function chooseModel(page: Page, name: string): Promise<void> {
  await modelButton(page).click();
  await page.getByRole('listbox', { name: 'Model' }).getByRole('option', { name }).click();
  await expect(modelButton(page)).toHaveText(name);
}

/** Whether an element's text is cut off with an ellipsis. */
const cutOff = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => el.scrollWidth > el.clientWidth);

test('thinking level: set, send, keep per session, reject and retry, hide', async () => {
  test.setTimeout(120_000);
  const profile = await newProfile();
  let mock: MockLlm | undefined;
  let context: BrowserContext | undefined;
  try {
    mock = await startMockLlm({ apiKey: KEY, models: [...MOCK_THINKING_MODELS, LONG_MODEL] });
    const efforts = mock.reasoningEfforts;
    context = await launchWithGrantedOrigins(profile.dir, [MOCK_ORIGIN]);
    const page = await openSidebar(context, await extensionId(context));

    // No provider yet: neither menu is in the composer.
    await expect(title(page)).toHaveText('New session');
    await expect(modelButton(page)).toHaveCount(0);
    await expect(control(page)).toHaveCount(0);
    await screen(page, 'T15-01-no-provider-hidden');

    // Add the provider through the form: the loaded list carries what each model supports.
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: 'Add provider' }).click();
    await field(page, 'Name').fill('Mock server');
    await field(page, 'Base URL').fill(mock.baseUrl);
    await field(page, 'API key').fill(KEY);
    await page.getByRole('button', { name: 'Load models' }).click();
    await expect(page.getByText('Model list loaded.')).toBeVisible();
    await field(page, 'Default model').selectOption('mock-large');
    // Test connection never carries a level.
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('The connection works.')).toBeVisible();
    expect(efforts).toEqual([undefined]);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.provider-list').getByText('Mock server')).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(input(page)).toBeEnabled();

    // The control: closed, at Default for a new session, next to the model menu.
    await expect(modelButton(page)).toHaveText('mock-large');
    await expect(control(page)).toHaveText('Default');
    await expect(control(page)).toHaveAccessibleName('Thinking level: Default');
    await expect(control(page)).toBeEnabled();
    await screens(page, 'T15-02-control-closed');

    // Open it and choose High with the keyboard only.
    await modelButton(page).focus();
    await page.keyboard.press('Tab');
    await expect(control(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(levels(page).getByRole('option')).toHaveText(['Default', 'Low', 'Medium', 'High']);
    await expect(levels(page).getByRole('option', { name: 'Default' })).toBeFocused();
    await expect(levels(page).getByRole('option', { name: 'Default' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await screens(page, 'T15-03-control-open');
    await page.keyboard.press('End');
    await expect(levels(page).getByRole('option', { name: 'High' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(levels(page)).toBeHidden();
    await expect(control(page)).toBeFocused();
    await expect(control(page)).toHaveText('High');
    await expect(control(page)).toHaveAccessibleName('Thinking level: High');
    // Choosing a level sends nothing.
    expect(efforts).toHaveLength(1);

    // Ask: the mock received reasoning_effort "high"; the title request carries none.
    mock.script(
      { kind: 'stream', chunks: ['Thinking harder ', 'gives a longer answer.'] },
      { kind: 'stream', chunks: ['Thinking levels'] },
    );
    await ask(page, 'What does a thinking level do?');
    await expect(answers(page).first()).toContainText('gives a longer answer.');
    await expect(title(page)).toHaveText('Thinking levels');
    expect(efforts).toEqual([undefined, 'high', undefined]);
    await screens(page, 'T15-04-high-answered');

    // A new session starts at Default and sends no level.
    await page.getByRole('button', { name: 'New session' }).click();
    await expect(title(page)).toHaveText('New session');
    await expect(control(page)).toHaveText('Default');
    mock.script(
      { kind: 'stream', chunks: ['A plain answer.'] },
      { kind: 'stream', chunks: ['Second session'] },
    );
    await ask(page, 'And without a level?');
    await expect(answers(page).first()).toContainText('A plain answer.');
    await expect(title(page)).toHaveText('Second session');
    expect(efforts.slice(3)).toEqual([undefined, undefined]);

    // Switch back: the first session still has High, also after reopening the sidebar.
    await page.getByRole('button', { name: 'Sessions' }).click();
    await page.getByRole('button', { name: /^Thinking levels/ }).click();
    await expect(title(page)).toHaveText('Thinking levels');
    await expect(control(page)).toHaveText('High');
    await page.reload();
    await expect(title(page)).toHaveText('Thinking levels');
    await expect(control(page)).toHaveText('High');
    await page.getByRole('button', { name: 'Sessions' }).click();
    await page.getByRole('button', { name: /^Second session/ }).click();
    await expect(control(page)).toHaveText('Default');
    await page.getByRole('button', { name: 'Sessions' }).click();
    await page.getByRole('button', { name: /^Thinking levels/ }).click();
    await expect(control(page)).toHaveText('High');

    // A model that rejects the level: the error with Retry, without the provider's text.
    await chooseModel(page, MOCK_REJECTING_MODEL);
    await expect(control(page)).toHaveText('High');
    await ask(page, 'Does this model take a level?');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(REJECTED);
    await expect(alert).not.toContainText('reasoning_effort');
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(efforts.slice(5)).toEqual(['high']);
    await screens(page, 'T15-05-rejected');
    // No automatic retry without the level.
    await page.waitForTimeout(300);
    expect(efforts).toHaveLength(6);

    // Set Default and retry: the same question now succeeds, without a level.
    await chooseLevel(page, 'Default');
    await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
    await expect(answers(page).nth(1)).toContainText(MOCK_REPLY);
    await expect(stopButton(page)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(efforts.slice(6)).toEqual([undefined]);
    await screen(page, 'T15-06-default-retry-ok');

    // Hidden for a model the list says takes no level; the stored level is kept, not sent.
    await chooseLevel(page, 'Medium');
    await chooseModel(page, MOCK_PLAIN_MODEL);
    await expect(control(page)).toHaveCount(0);
    await expect(modelButton(page)).toBeVisible();
    await ask(page, 'Hidden control?');
    await expect(answers(page).nth(2)).toContainText(MOCK_REPLY);
    await expect(stopButton(page)).toHaveCount(0);
    expect(efforts.slice(7)).toEqual([undefined]);
    await screen(page, 'T15-07-unsupported-hidden');

    // Shown again for a model the list calls supported, with the stored level.
    await chooseModel(page, MOCK_THINKING_MODEL);
    await expect(control(page)).toHaveText('Medium');
    await ask(page, 'Shown again?');
    await expect(answers(page).nth(3)).toContainText(MOCK_REPLY);
    await expect(stopButton(page)).toHaveCount(0);
    expect(efforts.slice(8)).toEqual(['medium']);

    // Every completion request went to the mock, with the key.
    const chats = mock.requests.filter((r) => r.path === '/v1/chat/completions');
    expect(chats).toHaveLength(efforts.length);
    expect(chats.every((r) => r.headers.authorization === `Bearer ${KEY}`)).toBe(true);
  } finally {
    await context?.close();
    await mock?.close();
    await profile.remove();
  }
});

test('thinking level: the composer toolbar fits a narrow sidebar with a long model name', async () => {
  const profile = await newProfile();
  let mock: MockLlm | undefined;
  let context: BrowserContext | undefined;
  try {
    mock = await startMockLlm({ apiKey: KEY, models: [...MOCK_THINKING_MODELS, LONG_MODEL] });
    context = await launchWithGrantedOrigins(profile.dir, [MOCK_ORIGIN]);
    const page = await openSidebar(context, await extensionId(context));
    await page.evaluate(
      async ({ baseUrl, key, model }) => {
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
              defaultModel: model,
              contextBudget: 100_000,
              cachedModels: ['mock-large', model],
              hasAccess: true,
            },
          ],
          defaultProviderId: 'mock',
        });
      },
      { baseUrl: mock.baseUrl, key: KEY, model: LONG_MODEL },
    );
    await page.reload();
    await expect(modelButton(page)).toHaveText(LONG_MODEL);
    await expect(control(page)).toHaveText('Default');
    await title(page).click();
    await page.getByRole('textbox', { name: 'Session title' }).fill('Quarterly pricing research');
    await page.keyboard.press('Enter');
    await expect(title(page)).toHaveText('Quarterly pricing research');

    const box = async (selector: string) => {
      const rect = await page.locator(selector).boundingBox();
      if (!rect) throw new Error(`${selector} has no box`);
      return rect;
    };
    const toolbar = ['#model-button', '#thinking-button', '#summarize-button', '#send-button'];
    /**
     * The composer's toolbar lies inside the sidebar on one line, the page
     * doesn't scroll sideways, and the header title keeps room (redesign spec 5.4).
     */
    const fits = async (width: number) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const first = await box(toolbar[0] ?? '');
      for (const selector of [...toolbar, '#settings-button']) {
        const rect = await box(selector);
        expect(rect.x, selector).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width, selector).toBeLessThanOrEqual(width);
        if (selector !== '#settings-button') {
          // One line: every control's middle on the model button's.
          expect(
            Math.abs(rect.y + rect.height / 2 - (first.y + first.height / 2)),
            selector,
          ).toBeLessThan(2);
        }
      }
      const titleBox = await box('.header-title');
      expect(titleBox.width, 'title').toBeGreaterThanOrEqual(48);
    };

    // Narrow: the level's value is not cut off; the long model name gives way.
    for (const width of [320, 400]) {
      await page.setViewportSize({ width, height: 720 });
      await fits(width);
      expect(await cutOff(page, '#thinking-button .model-button-text')).toBe(false);
      expect(await cutOff(page, '#model-button .model-button-text')).toBe(true);
      await screen(page, `T15-08-narrow-${String(width)}`);
    }

    // The longest value still fits at the narrowest width, and the list stays inside, above the composer.
    await page.setViewportSize({ width: 320, height: 720 });
    await chooseLevel(page, 'Medium');
    expect(await cutOff(page, '#thinking-button .model-button-text')).toBe(false);
    await control(page).click();
    const list = await box('.thinking-list');
    const button = await box('#thinking-button');
    expect(list.x).toBeGreaterThanOrEqual(0);
    expect(list.x + list.width).toBeLessThanOrEqual(320);
    expect(list.y).toBeGreaterThanOrEqual(0);
    expect(list.y + list.height).toBeLessThanOrEqual(button.y);
    await screens(page, 'T15-09-narrow-320-open');
    await page.keyboard.press('Escape');
    await fits(320);

    // Wide: the model name has room.
    await page.setViewportSize({ width: 640, height: 720 });
    await fits(640);
    expect(await cutOff(page, '#thinking-button .model-button-text')).toBe(false);
    await screen(page, 'T15-10-wide-640');
  } finally {
    await context?.close();
    await mock?.close();
    await profile.remove();
  }
});
