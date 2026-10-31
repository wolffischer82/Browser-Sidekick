import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { chunkText, startMockLlm, type MockLlm } from '../mock-llm/server';
import {
  extensionId,
  launchWithGrantedOrigins,
  newProfile,
  openSidebarWindow,
} from '../e2e/extension';
import { startFixtureServer, type FixtureServer } from '../e2e/fixture-server';
import { CONTENT, MODELS, type Lang, type StoreContent } from './content';
import { listingField } from './listing';
import { ASSETS_DIR, pngSize, PROMO_SIZE, SCREENSHOT_SIZE, sizeProblems } from './png';

// Store screenshots and promo tiles (spec store-publishing 4.4), run by
// `npm run store:assets` (playwright.store.config.ts), never by `npm run e2e`.
// The extension talks only to the local mock LLM; the pages are fixtures on
// made-up `.example` hosts: Chromium sends every non-loopback request through
// the fixture server as a proxy, so nothing reaches the internet (HTTPS
// tunnels are refused). Each screenshot puts the page (800 px) next to the
// sidebar (480 px) at 1280×800.

const ROOT = resolve(import.meta.dirname, '../..');
const PAGE_WIDTH = 800;
const SIDEBAR_WIDTH = SCREENSHOT_SIZE.width - PAGE_WIDTH;
const HEIGHT = SCREENSHOT_SIZE.height;

/** Wednesday 28 October 2026, 10:30 local time, so dates in the UI are stable. */
const NOW = new Date(2026, 9, 28, 10, 30);

type Messages = Record<string, { message: string }>;

async function messages(lang: Lang): Promise<(key: string) => string> {
  const file = resolve(ROOT, `public/_locales/${lang}/messages.json`);
  const all = JSON.parse(await readFile(file, 'utf8')) as Messages;
  return (key) => {
    const entry = all[key];
    if (!entry) throw new Error(`Missing message ${key}.`);
    return entry.message;
  };
}

interface ChromeApi {
  storage: { local: { set(o: object): Promise<void> } };
}

/** Two fictional providers on the mock server; the first is the default. */
async function seedProviders(sidebar: Page, mock: MockLlm, content: StoreContent): Promise<void> {
  await sidebar.evaluate(
    async ({ baseUrl, models, names }) => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      const provider = (id: string, label: string, model: string) => ({
        id,
        kind: 'openai-compatible',
        label,
        baseUrl,
        apiKey: 'demo-key-not-real',
        defaultModel: model,
        contextBudget: 100_000,
        cachedModels: models,
        hasAccess: true,
      });
      await chrome.storage.local.set({
        providers: [
          provider('local', names.local, 'nova-2'),
          provider('lab', names.lab, 'orion-mini'),
        ],
        defaultProviderId: 'local',
      });
    },
    { baseUrl: mock.baseUrl, models: MODELS, names: content.providers },
  );
}

/** Sets each named session's last activity in IndexedDB, from the sidebar page. */
async function setActivity(page: Page, times: [string, number][]): Promise<void> {
  await page.evaluate(async (entries) => {
    const wanted = new Map(entries);
    const db = await new Promise<IDBDatabase>((done, fail) => {
      const open = indexedDB.open('sidekick');
      open.onsuccess = () => {
        done(open.result);
      };
      open.onerror = () => {
        fail(new Error('open failed'));
      };
    });
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const all = await new Promise<{ title: string; updatedAt: number }[]>((done) => {
      const request = store.getAll();
      request.onsuccess = () => {
        done(request.result as { title: string; updatedAt: number }[]);
      };
    });
    for (const session of all) {
      const time = wanted.get(session.title);
      if (time !== undefined) store.put({ ...session, updatedAt: time });
    }
    await new Promise<void>((done) => {
      tx.oncomplete = () => {
        done();
      };
    });
    db.close();
  }, times);
}

function dataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** Saves a PNG and fails unless it has exactly the required size. */
async function save(png: Buffer, name: string, size: { width: number; height: number }) {
  expect(pngSize(png), name).toEqual(size);
  await writeFile(resolve(ASSETS_DIR, name), png);
}

/** The page on the left, the sidebar on the right, at 1280×800. */
async function compose(
  context: BrowserContext,
  left: Page,
  sidebar: Page,
  name: string,
): Promise<void> {
  const pageShot = await left.screenshot();
  const sidebarShot = await sidebar.screenshot();
  const stage = await context.newPage();
  await stage.setViewportSize(SCREENSHOT_SIZE);
  await stage.setContent(
    `<!doctype html><html><body style="margin:0;display:flex;width:${String(SCREENSHOT_SIZE.width)}px;height:${String(HEIGHT)}px;overflow:hidden;background:#fff">` +
      `<img src="${dataUrl(pageShot)}" width="${String(PAGE_WIDTH)}" height="${String(HEIGHT)}" style="display:block">` +
      `<img src="${dataUrl(sidebarShot)}" width="${String(SIDEBAR_WIDTH)}" height="${String(HEIGHT)}" style="display:block;box-shadow:-1px 0 0 #d6d6d0,-8px 0 24px rgb(20 20 25 / 10%);position:relative">` +
      `</body></html>`,
  );
  await stage.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  await save(await stage.screenshot(), name, SCREENSHOT_SIZE);
  await stage.close();
}

async function screenshots(lang: Lang): Promise<void> {
  const content = CONTENT[lang];
  const t = await messages(lang);
  let server: FixtureServer | undefined;
  let mock: MockLlm | undefined;
  let context: BrowserContext | undefined;
  const profile = await newProfile();
  try {
    server = await startFixtureServer();
    mock = await startMockLlm({ models: MODELS });
    // Chromium never proxies loopback addresses (the mock); everything else
    // goes to the fixture server.
    const proxy = [`--proxy-server=${server.origin}`];
    context = await launchWithGrantedOrigins(profile.dir, ['<all_urls>'], proxy, content.locale);
    await context.clock.setFixedTime(NOW);
    const browser = context;
    const id = await extensionId(browser);
    const url = (index: 0 | 1 | 2) =>
      `http://${content.pages[index].host}/${content.pages[index].file}`;

    const tabs: Page[] = [];
    const first = browser.pages()[0] ?? (await browser.newPage());
    await first.setViewportSize({ width: PAGE_WIDTH, height: HEIGHT });
    tabs.push(first);
    const sidebar = await openSidebarWindow(browser, id);
    await sidebar.setViewportSize({ width: SIDEBAR_WIDTH, height: HEIGHT });
    await seedProviders(sidebar, mock, content);
    await sidebar.reload();
    await expect(sidebar.locator('html')).toHaveAttribute('lang', new RegExp(`^${lang}`));

    const input = sidebar.getByRole('textbox', { name: t('inputPlaceholder') });
    const titleButton = sidebar.getByTitle(t('renameSession'));
    const currentRow = sidebar.locator('.tab-row[data-current]');
    const stop = sidebar.locator('.stop-button');
    await expect(input).toBeEnabled();

    // Older sessions for the sessions list, oldest first; the last one stays active.
    const rename = async (name: string) => {
      await titleButton.click();
      const field = sidebar.getByRole('textbox', { name: t('sessionTitleLabel') });
      await field.fill(name);
      await field.press('Enter');
      await expect(titleButton).toHaveText(name);
    };
    for (const [index, [name]] of content.olderSessions.entries()) {
      if (index > 0) {
        await sidebar
          .getByRole('button', { name: t('newSession') })
          .first()
          .click();
        await expect(titleButton).toHaveText(t('fallbackTitle'));
      }
      await rename(name);
    }
    await sidebar
      .getByRole('button', { name: t('newSession') })
      .first()
      .click();
    await expect(titleButton).toHaveText(t('fallbackTitle'));
    await setActivity(
      sidebar,
      content.olderSessions.map(([name, minutes]) => [name, NOW.getTime() - minutes * 60_000]),
    );

    // Pin the three pages in order, each from its own tab.
    for (const index of [0, 1, 2] as const) {
      const tab = tabs[index] ?? (await browser.newPage());
      if (!tabs[index]) {
        await tab.setViewportSize({ width: PAGE_WIDTH, height: HEIGHT });
        tabs.push(tab);
      }
      await tab.goto(url(index));
      await tab.bringToFront();
      await expect(currentRow).toContainText(content.pages[index].host);
      await currentRow.getByRole('button', { name: t('pinToSession') }).click();
      await expect(sidebar.locator('li.pin-row')).toHaveCount(index + 1);
    }
    await expect(sidebar.locator('li.pin-row[data-status="ready"]')).toHaveCount(3);
    const tab = (index: 0 | 1 | 2): Page => {
      const found = tabs[index];
      if (!found) throw new Error('Missing tab.');
      return found;
    };

    // 1. A question answered with citations. The session is named after its
    // first pin, so no title request follows; it gets a short name by hand.
    await tab(0).bringToFront();
    await expect(sidebar.locator('li.pin-row[data-current]')).toHaveCount(1);
    mock.script({ kind: 'stream', chunks: chunkText(content.answer, 12) });
    await input.fill(content.question);
    await input.press('Enter');
    const answers = sidebar.getByRole('article', { name: t('chatAnswerLabel') });
    await expect(answers.first().locator('button.citation').first()).toBeVisible();
    await expect(stop).toHaveCount(0, { timeout: 20_000 });
    await expect(answers).toHaveCount(1);
    await rename(content.sessionTitle);
    await sidebar.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    // Show the question above its answer.
    await answers.first().evaluate((el) => {
      (el.previousElementSibling ?? el).scrollIntoView({ block: 'start' });
    });
    await sidebar.mouse.move(0, HEIGHT - 1);
    await compose(browser, tab(0), sidebar, `screenshot-1-answer.${lang}.png`);

    // 2. Summarize, with the second page as the current tab.
    await tab(1).bringToFront();
    await expect(currentRow).toContainText(content.pages[1].host);
    mock.script({ kind: 'stream', chunks: chunkText(content.summary, 12) });
    await sidebar.getByRole('button', { name: t('summarize'), exact: true }).click();
    await expect(answers).toHaveCount(2, { timeout: 20_000 });
    await expect(stop).toHaveCount(0);
    // Show the summary from its start.
    await answers.nth(1).evaluate((el) => {
      const question = el.previousElementSibling ?? el;
      question.scrollIntoView({ block: 'start' });
    });
    await sidebar.mouse.move(0, HEIGHT - 1);
    await compose(browser, tab(1), sidebar, `screenshot-2-summary.${lang}.png`);

    // 3. The sessions list, grouped by date.
    await tab(2).bringToFront();
    await expect(currentRow).toContainText(content.pages[2].host);
    await sidebar
      .getByRole('button', { name: t('sessions') })
      .first()
      .click();
    const drawer = sidebar.getByRole('dialog', { name: t('sessions') });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.session-item')).toHaveCount(content.olderSessions.length + 1);
    await sidebar.mouse.move(SIDEBAR_WIDTH - 1, HEIGHT - 1);
    await compose(browser, tab(2), sidebar, `screenshot-3-sessions.${lang}.png`);
    await drawer.getByRole('button', { name: t('close') }).click();
    await expect(drawer).toBeHidden();

    // 4. Settings with the two providers.
    await tab(0).bringToFront();
    await sidebar.getByRole('button', { name: t('settings'), exact: true }).click();
    await expect(sidebar.locator('.provider-row')).toHaveCount(2);
    await expect(sidebar.getByText(t('pageAccessAllowed'))).toBeVisible();
    await sidebar.mouse.move(0, HEIGHT - 1);
    await compose(browser, tab(0), sidebar, `screenshot-4-settings.${lang}.png`);

    // The pages came from the fixture server, which also answered Chromium's
    // own background requests (such as its network time check) with 404, and
    // the LLM requests went to the mock.
    expect(server.requests).toEqual(expect.arrayContaining(content.pages.map((p) => `/${p.file}`)));
    expect(mock.requests.length).toBeGreaterThan(0);
    expect(mock.requests.every((r) => r.path.startsWith('/v1/'))).toBe(true);
  } finally {
    await context?.close();
    await profile.remove();
    await mock?.close();
    await server?.close();
  }
}

/** The small promo tile: icon, name and the Chrome short description. */
async function promo(context: BrowserContext, lang: Lang): Promise<void> {
  const icon = await readFile(resolve(ROOT, 'design/icon.svg'), 'utf8');
  const font = await readFile(
    resolve(ROOT, 'src/entrypoints/sidepanel/fonts/geist-latin-wght-normal.woff2'),
  );
  const fontExt = await readFile(
    resolve(ROOT, 'src/entrypoints/sidepanel/fonts/geist-latin-ext-wght-normal.woff2'),
  );
  const name = (await messages(lang))('extName');
  const tagline = listingField(lang, 'Chrome short description');
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const page = await context.newPage();
  await page.setViewportSize(PROMO_SIZE);
  await page.setContent(`<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><style>
@font-face { font-family: Geist; font-weight: 100 900; src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2'); unicode-range: U+0000-00FF, U+2000-206F, U+20AC; }
@font-face { font-family: Geist; font-weight: 100 900; src: url(data:font/woff2;base64,${fontExt.toString('base64')}) format('woff2'); unicode-range: U+0100-024F, U+1E00-1EFF; }
html, body { margin: 0; width: ${String(PROMO_SIZE.width)}px; height: ${String(PROMO_SIZE.height)}px; overflow: hidden; }
body { box-sizing: border-box; padding: 36px 36px; display: flex; flex-direction: column; justify-content: center; gap: 20px;
  font-family: Geist, sans-serif; color: #17181b; background: linear-gradient(135deg, #f6f6f3 0%, #eef2fc 100%); }
.head { display: flex; align-items: center; gap: 14px; }
.head svg { width: 64px; height: 64px; flex: none; }
h1 { margin: 0; font-size: 30px; white-space: nowrap; line-height: 1.1; font-weight: 650; letter-spacing: -0.02em; }
p { margin: 0; font-size: 21px; line-height: 1.35; font-weight: 450; color: #3c3f46; }
</style></head><body>
<div class="head">${icon}<h1>${escape(name)}</h1></div>
<p>${escape(tagline)}</p>
</body></html>`);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await save(await page.screenshot(), `promo-small.${lang}.png`, PROMO_SIZE);
  await page.close();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await mkdir(ASSETS_DIR, { recursive: true });
});

for (const lang of ['en', 'de'] as const) {
  test(`screenshots (${lang})`, async () => {
    test.setTimeout(180_000);
    await screenshots(lang);
  });
}

test('promo tiles', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  try {
    for (const lang of ['en', 'de'] as const) await promo(context, lang);
  } finally {
    await context.close();
  }
});

test('every asset has the required size', () => {
  expect(sizeProblems()).toEqual([]);
});
