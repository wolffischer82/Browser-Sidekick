import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startMockLlm, type MockLlm } from '../mock-llm/server';
import {
  extensionId,
  launchWithGrantedOrigins,
  newProfile,
  openSidebar,
  screens,
} from './extension';

// T21 (specs/redesign.md O4, 5.1, 5.4): New session sits in the composer
// toolbar between the spacer and Summarize, and the header has Sessions,
// the title and Settings only. It starts a session as the header button
// did and keeps focus; it stays usable and unfaded with no provider and
// with no host access. At 320 px nothing in the toolbar wraps or
// overflows, and a long model name truncates first. Screens at 400 and
// 320 px, light and dark: idle and no provider
// (test-results/screens/T21-*.png).

const KEY = 'sk-mock-new-session-e2e-3c1d';
const LONG_MODEL = 'mock-large-with-a-rather-long-model-name-2026-10-06';
const TOOLBAR = [
  '#model-button',
  '#thinking-button',
  '#new-session-button',
  '#summarize-button',
  '#send-button',
];

interface ChromeApi {
  storage: { local: { set(o: object): Promise<void> } };
  permissions: { remove(p: { origins: string[] }): Promise<boolean> };
}

const newSession = (page: Page) => page.getByRole('button', { name: 'New session', exact: true });
const title = (page: Page) => page.getByTitle('Rename session');

async function seedProvider(sidebar: Page, mock: MockLlm, model: string): Promise<void> {
  await sidebar.evaluate(
    async ({ baseUrl, key, model }) => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      await chrome.storage.local.set({
        providers: [
          {
            id: 'mock',
            kind: 'openai-compatible',
            label: 'Mock server',
            baseUrl,
            apiKey: key,
            defaultModel: model,
            contextBudget: 100_000,
            cachedModels: [model],
            hasAccess: true,
          },
        ],
        defaultProviderId: 'mock',
      });
    },
    { baseUrl: mock.baseUrl, key: KEY, model },
  );
}

async function box(page: Page, selector: string) {
  const rect = await page.locator(selector).first().boundingBox();
  if (!rect) throw new Error(`${selector} has no box`);
  return rect;
}

/** The header holds Sessions, the title and Settings; the toolbar the O4 order. */
async function layout(page: Page): Promise<void> {
  await expect(page.locator('#settings-button')).toBeVisible();
  const titles = await page
    .locator('header button')
    .evaluateAll((bs: HTMLButtonElement[]) => bs.map((b) => b.title));
  expect(titles).toEqual(['Sessions', 'Rename session', 'Settings']);
  const shown: string[] = [];
  for (const selector of TOOLBAR) {
    if ((await page.locator(selector).count()) > 0) shown.push(selector);
  }
  expect(
    await page
      .locator('.composer-toolbar button')
      .evaluateAll((bs) => bs.map((b) => `#${b.id}`).filter((id) => id !== '#')),
  ).toEqual(shown);
}

/** Every toolbar control lies on one line inside the panel; nothing scrolls sideways. */
async function toolbarFits(page: Page, width: number): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
  const first = await box(page, '#new-session-button');
  for (const selector of TOOLBAR) {
    if ((await page.locator(selector).count()) === 0) continue;
    const rect = await box(page, selector);
    expect(rect.x, selector).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width, selector).toBeLessThanOrEqual(width);
    expect(
      Math.abs(rect.y + rect.height / 2 - (first.y + first.height / 2)),
      selector,
    ).toBeLessThan(2);
  }
  // Same height as Summarize.
  expect((await box(page, '#new-session-button')).height).toBe(
    (await box(page, '#summarize-button')).height,
  );
}

/** Starts a session from the composer; focus stays on the button. */
async function startSession(page: Page): Promise<void> {
  await title(page).click();
  const input = page.getByRole('textbox', { name: 'Session title' });
  await input.fill('Earlier');
  await input.press('Enter');
  await expect(title(page)).toHaveText('Earlier');
  await expect(newSession(page)).toBeEnabled();
  await expect(newSession(page)).toHaveCSS('opacity', '1');
  await newSession(page).click();
  await expect(title(page)).toHaveText('New session');
  await expect(newSession(page)).toBeFocused();
}

async function bothWidths(page: Page, name: string): Promise<void> {
  for (const width of [400, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await toolbarFits(page, width);
    await screens(page, `${name}-${String(width)}`);
  }
  await page.setViewportSize({ width: 400, height: 720 });
}

test.describe('New session in the composer', () => {
  let mock: MockLlm;
  let context: BrowserContext | undefined;
  let removeProfile: (() => Promise<void>) | undefined;

  test.beforeEach(async () => {
    mock = await startMockLlm({ apiKey: KEY });
  });

  test.afterEach(async () => {
    await context?.close();
    await removeProfile?.();
    await mock.close();
    context = undefined;
  });

  test('sits next to Summarize, works without a provider or access, and fits at 320 px', async () => {
    test.setTimeout(120_000);
    const profile = await newProfile();
    removeProfile = profile.remove;
    // The mock's origin is granted, as after the provider form's prompt.
    const origin = `${new URL(mock.baseUrl).origin}/*`;
    context = await launchWithGrantedOrigins(profile.dir, [origin]);
    const sidebar = await openSidebar(context, await extensionId(context));
    await sidebar.setViewportSize({ width: 400, height: 720 });

    // 1. No provider: the card's contents fade, New session doesn't, and it works.
    await expect(sidebar.locator('#composer-hint')).toBeVisible();
    await layout(sidebar);
    await expect(newSession(sidebar)).toHaveAttribute('title', 'New session');
    await bothWidths(sidebar, 'T21-01-no-provider');
    await startSession(sidebar);

    // 2. Idle with a provider and a long model name: the name truncates first.
    await seedProvider(sidebar, mock, LONG_MODEL);
    await sidebar.reload();
    await startSession(sidebar);
    await expect(sidebar.locator('#model-button')).toContainText(LONG_MODEL);
    await layout(sidebar);
    await bothWidths(sidebar, 'T21-02-idle');
    await sidebar.setViewportSize({ width: 320, height: 720 });
    const name = sidebar.locator('#model-button .model-button-text');
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    // The buttons after the spacer keep their full size.
    expect((await box(sidebar, '#new-session-button')).width).toBe(30);
    expect((await box(sidebar, '#send-button')).width).toBe(32);
    const label = await sidebar.locator('#summarize-button').evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(label.scroll).toBeLessThanOrEqual(label.client);
    await sidebar.setViewportSize({ width: 400, height: 720 });

    // 3. The session's provider loses host access: New session still works.
    await sidebar.evaluate(async (o) => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      await chrome.permissions.remove({ origins: [o] });
    }, origin);
    await sidebar.reload();
    await expect(sidebar.locator('#composer-hint')).toContainText('No access to Mock server');
    await layout(sidebar);
    await startSession(sidebar);

    // Nothing called a provider.
    expect(mock.requests.filter((r) => r.path === '/v1/chat/completions')).toHaveLength(0);
  });
});
