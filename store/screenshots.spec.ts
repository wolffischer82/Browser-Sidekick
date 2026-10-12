import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { chunkText, startMockLlm, type MockLlm } from '../tests/mock-llm/server';
import {
  extensionId,
  launchWithGrantedOrigins,
  newProfile,
  openSidebarWindow,
} from '../tests/e2e/extension';

// Store screenshots (docs/store-release.md): the real Chrome build against the
// mock LLM and the demo pages in store/pages, framed as a browser window with
// the side panel docked on the right. `npm run build:chrome` first, then
// `npm run store:screens`. Output: store/screenshots/*.png at 1280x800, plus
// the promo tiles. Nothing here talks to a real provider.

const OUT = resolve(import.meta.dirname, 'screenshots');
const PAGES = resolve(import.meta.dirname, 'pages');
const ICON = resolve(import.meta.dirname, '../public/icon/128.png');

const W = 1280;
const H = 800;
const BAR = 76; // tab strip + address bar
const PANEL = 400;

const KEY = 'sk-store-screens';
const MODELS = ['qwen3:32b', 'llama3.3:70b', 'gemma3:27b'];

const COLD = 'Do heat pumps work in a real cold snap? | Northern Home Journal';
const COSTS = 'Heat pump or gas boiler: a year of heating costs compared | The Ledger';
const GRANT = 'Home heating grant 2026: who can apply | Energy Advice Service';

const ANSWER = [
  'Yes. In a field test of 40 homes through a winter down to −22 °C, **37 stayed at their set temperature** every day [1]. Efficiency drops in the cold (COP about 1.8 on the coldest days, 3.1 over the season), so correct sizing matters most [1].',
  '',
  'Running costs for a 120 m² house:',
  '',
  '- **Heat pump:** about 1,280 a year [2]',
  '- **Gas boiler:** about 1,560 a year [2]',
  '',
  'The 2026 grant covers 30–40 % of the installation if your home was built before 2010 [3].',
].join('\n');

const SUMMARY = [
  '**TL;DR:** Heat pumps keep homes warm even at −20 °C when sized right, cost less to run than gas, and a 2026 grant cuts the upfront price.',
  '',
  '### Do heat pumps work in a real cold snap? [1]',
  '',
  '37 of 40 homes stayed warm through −22 °C; undersized pumps were the problem [1].',
  '',
  '### Heat pump or gas boiler [2]',
  '',
  'About 1,280 versus 1,560 a year for a 120 m² house [2].',
  '',
  '### Home heating grant 2026 [3]',
  '',
  'Up to 40 % of eligible costs; apply before work starts, by 15 December [3].',
].join('\n');

interface ChromeApi {
  storage: { local: { set(o: object): Promise<void> } };
}

const input = (page: Page) => page.getByRole('textbox', { name: 'Ask about these pages…' });
const currentRow = (page: Page) => page.locator('.tab-row[data-current]');
const pinRow = (page: Page, title: string) => page.locator('li.pin-row', { hasText: title });
const answers = (page: Page) => page.getByRole('article', { name: 'Answer' });

/** Serves store/pages under made-up https hosts, so the pins show real-looking sites. */
const SITES: Record<string, string> = {
  'cold-test.html': 'https://northern-home.example/heat-pumps-cold-snap',
  'running-costs.html': 'https://the-ledger.example/heat-pump-vs-gas',
  'grant.html': 'https://energy-advice.example/heating-grant-2026',
};

async function routePages(context: BrowserContext): Promise<void> {
  for (const [file, url] of Object.entries(SITES)) {
    const body = await readFile(join(PAGES, file));
    await context.route(url, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }),
    );
  }
}

async function seedProviders(sidebar: Page, mock: MockLlm): Promise<void> {
  await sidebar.evaluate(
    async ({ baseUrl, key, models }) => {
      const chrome = (globalThis as unknown as { chrome: ChromeApi }).chrome;
      await chrome.storage.local.set({
        providers: [
          {
            id: 'local',
            kind: 'openai-compatible',
            label: 'Ollama (local)',
            baseUrl,
            apiKey: key,
            defaultModel: models[0],
            contextBudget: 100_000,
            cachedModels: models,
            hasAccess: true,
          },
          {
            id: 'anthropic',
            kind: 'anthropic',
            label: 'Anthropic',
            baseUrl: '',
            apiKey: 'sk-ant-demo-0000000000000000',
            defaultModel: 'claude-model',
            contextBudget: 100_000,
            cachedModels: null,
            hasAccess: true,
          },
          {
            id: 'gemini',
            kind: 'gemini',
            label: 'Google Gemini',
            baseUrl: '',
            apiKey: 'AIza-demo-00000000000000000000',
            defaultModel: 'gemini-model',
            contextBudget: 100_000,
            cachedModels: null,
            hasAccess: true,
          },
        ],
        defaultProviderId: 'local',
      });
    },
    { baseUrl: mock.baseUrl, key: KEY, models: MODELS },
  );
}

/** Frames a page shot and a panel shot as one browser window, with a caption. */
async function compose(
  context: BrowserContext,
  name: string,
  page: Buffer,
  panel: Buffer,
  url: string,
  caption: string,
  dark = false,
): Promise<void> {
  const b64 = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
  const chrome = dark
    ? { strip: '#1f1f22', bar: '#2b2b2f', field: '#3a3a3f', text: '#e6e6e6', line: '#3d3d42' }
    : { strip: '#dfe3e8', bar: '#f6f7f9', field: '#e9ebef', text: '#3c4043', line: '#d0d4da' };
  const tab = await context.newPage();
  await tab.setViewportSize({ width: W, height: H });
  await tab.setContent(`<!doctype html><html><body style="margin:0;width:${String(W)}px;height:${String(H)}px;overflow:hidden;font-family:system-ui,sans-serif;background:${chrome.bar}">
    <div style="height:36px;background:${chrome.strip};display:flex;align-items:flex-end;padding-left:12px;gap:6px">
      <span style="width:12px;height:12px;border-radius:50%;background:#ff5f57;margin:0 0 12px 4px"></span>
      <span style="width:12px;height:12px;border-radius:50%;background:#febc2e;margin-bottom:12px"></span>
      <span style="width:12px;height:12px;border-radius:50%;background:#28c840;margin:0 12px 12px 0"></span>
      <div style="background:${chrome.bar};color:${chrome.text};font-size:12px;padding:8px 14px;border-radius:8px 8px 0 0;width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${url.split('|')[0] ?? ''}</div>
    </div>
    <div style="height:${String(BAR - 36)}px;display:flex;align-items:center;padding:0 14px;gap:10px;border-bottom:1px solid ${chrome.line};box-sizing:border-box">
      <div style="flex:1;background:${chrome.field};color:${chrome.text};font-size:13px;border-radius:14px;padding:6px 14px">${url.split('|')[1] ?? ''}</div>
      <img src="${b64(await readFile(ICON))}" style="width:18px;height:18px">
    </div>
    <div style="display:flex;height:${String(H - BAR)}px">
      <img src="${b64(page)}" style="width:${String(W - PANEL)}px;height:${String(H - BAR)}px;display:block">
      <img src="${b64(panel)}" style="width:${String(PANEL)}px;height:${String(H - BAR)}px;display:block;border-left:1px solid ${chrome.line}">
    </div>
    <div style="position:absolute;left:28px;bottom:28px;max-width:${String(W - PANEL - 96)}px;background:#1b1f2a;color:#fff;font-size:22px;font-weight:600;line-height:1.3;padding:14px 20px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25)">${caption}</div>
  </body></html>`);
  await tab.screenshot({ path: join(OUT, `${name}.png`) });
  await tab.close();
}

/** Promo tiles: icon, name and tagline on the accent background. */
async function promo(context: BrowserContext, name: string, w: number, h: number, scale: number) {
  const tab = await context.newPage();
  await tab.setViewportSize({ width: w, height: h });
  const icon = `data:image/png;base64,${(await readFile(ICON)).toString('base64')}`;
  await tab.setContent(`<!doctype html><html><body style="margin:0;width:${String(w)}px;height:${String(h)}px;display:flex;align-items:center;justify-content:center;gap:${String(24 * scale)}px;background:linear-gradient(135deg,#1b1f2a,#2d3550);color:#fff;font-family:system-ui,sans-serif">
    <img src="${icon}" style="width:${String(96 * scale)}px;height:${String(96 * scale)}px">
    <div><div style="font-size:${String(34 * scale)}px;font-weight:700">Browser Sidekick</div>
    <div style="font-size:${String(17 * scale)}px;opacity:.85;margin-top:${String(6 * scale)}px;max-width:${String(260 * scale)}px">Pin pages. Ask your own LLM about them.</div></div>
  </body></html>`);
  await tab.screenshot({ path: join(OUT, `${name}.png`) });
  await tab.close();
}

test('store screenshots', async () => {
  test.setTimeout(240_000);
  await mkdir(OUT, { recursive: true });
  const mock = await startMockLlm({ apiKey: KEY, models: MODELS });
  const profile = await newProfile();
  const browser = await launchWithGrantedOrigins(profile.dir, ['<all_urls>']);
  try {
    await routePages(browser);
    const id = await extensionId(browser);
    const tab = browser.pages()[0] ?? (await browser.newPage());
    await tab.setViewportSize({ width: W - PANEL, height: H - BAR });
    const sidebar = await openSidebarWindow(browser, id);
    await sidebar.setViewportSize({ width: PANEL, height: H - BAR });
    await seedProviders(sidebar, mock);
    await sidebar.reload();
    await expect(input(sidebar)).toBeEnabled();

    // Pin two articles, then open the grant page as the current tab.
    for (const [file, title] of [
      ['cold-test.html', COLD],
      ['running-costs.html', COSTS],
    ] as const) {
      await tab.goto(SITES[file] ?? '');
      await expect(currentRow(sidebar)).toContainText(title);
      await currentRow(sidebar).getByRole('button', { name: 'Pin to session' }).click();
      await expect(pinRow(sidebar, title)).toHaveAttribute('data-status', 'ready');
    }
    await tab.goto(SITES['grant.html'] ?? '');
    await expect(currentRow(sidebar)).toContainText(GRANT);

    // 1. A question answered from the pins and the current tab.
    mock.script(
      { kind: 'stream', chunks: chunkText(ANSWER, 12) },
      { kind: 'stream', chunks: ['"Heat pump decision"'] },
    );
    await input(sidebar).fill('Do heat pumps work in a hard winter, and what do they cost to run?');
    await input(sidebar).press('Enter');
    await expect(answers(sidebar).last()).toContainText('2010');
    await expect(sidebar.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    await expect(sidebar.getByTitle('Rename session')).toHaveText('Heat pump decision');
    await sidebar.mouse.move(PANEL / 2, 120);
    const grantShot = await tab.screenshot();
    await compose(
      browser,
      '1-ask',
      grantShot,
      await sidebar.screenshot(),
      'Home heating grant 2026|energy-advice.example/heating-grant-2026',
      'Ask your own LLM about the pages you pinned and the tab you’re on',
    );

    // 2. The same in dark mode.
    await sidebar.emulateMedia({ colorScheme: 'dark' });
    await compose(
      browser,
      '4-dark',
      grantShot,
      await sidebar.screenshot(),
      'Home heating grant 2026|energy-advice.example/heating-grant-2026',
      'Light and dark, following your system',
      true,
    );
    await sidebar.emulateMedia({ colorScheme: 'light' });

    // 3. Summarize the session.
    mock.script({ kind: 'stream', chunks: chunkText(SUMMARY, 12) });
    await sidebar.getByRole('button', { name: /^Session tabs/ }).click();
    await sidebar.getByRole('button', { name: 'Summarize', exact: true }).click();
    await expect(answers(sidebar).last()).toContainText('15 December');
    await expect(sidebar.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    await sidebar.getByRole('article', { name: 'Your question' }).last().scrollIntoViewIfNeeded();
    await sidebar
      .getByRole('article', { name: 'Your question' })
      .last()
      .evaluate((el) => {
        el.scrollIntoView({ block: 'start' });
      });
    await compose(
      browser,
      '2-summarize',
      grantShot,
      await sidebar.screenshot(),
      'Home heating grant 2026|energy-advice.example/heating-grant-2026',
      'Summarize every pinned page in one go, with sources',
    );

    // 4. Settings: your own providers and keys.
    await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(sidebar.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await tab.goto(SITES['running-costs.html'] ?? '');
    await compose(
      browser,
      '3-providers',
      await tab.screenshot(),
      await sidebar.screenshot(),
      'Heat pump or gas boiler|the-ledger.example/heat-pump-vs-gas',
      'Bring your own key: Anthropic, Gemini, OpenAI-compatible or a local model',
    );

    await promo(browser, 'promo-small-440x280', 440, 280, 0.7);
    await promo(browser, 'promo-marquee-1400x560', 1400, 560, 1.6);
  } finally {
    await browser.close();
    await profile.remove();
    await mock.close();
  }
});
