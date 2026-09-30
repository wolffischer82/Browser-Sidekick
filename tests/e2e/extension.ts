import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

/** The unpacked Chrome build (`npm run build:chrome`). */
export const EXTENSION_DIR = resolve(import.meta.dirname, '../../dist/chrome-ext');

/** Screenshots for the orchestrator's review (gitignored, never uploaded). */
export const SCREENS_DIR = resolve(import.meta.dirname, '../../test-results/screens');

/** A throwaway Chromium profile; reusing it across launches simulates a browser restart. */
export async function newProfile(): Promise<{ dir: string; remove: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'sidekick-e2e-'));
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Launches Playwright's Chromium with the extension loaded. The `chromium`
 * channel uses the new headless mode, which supports extensions. The UI
 * language is English so assertions can use the `en` strings.
 */
export async function launchWithExtension(profileDir: string): Promise<BrowserContext> {
  if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
    throw new Error('dist/chrome-ext is missing. Run `npm run build:chrome` first.');
  }
  return chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    locale: 'en-US',
    colorScheme: 'light',
    // Drawer and chevron animations off, for stable screenshots.
    reducedMotion: 'reduce',
    viewport: { width: 400, height: 720 },
    args: [
      '--lang=en-US',
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      // Allows CDP `Extensions.loadUnpacked`, used by `reloadExtension`.
      '--enable-unsafe-extension-debugging',
    ],
  });
}

/** The extension id, read from its background service worker URL. */
export async function extensionId(context: BrowserContext): Promise<string> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return new URL(worker.url()).host;
}

/** Opens the sidebar page as a normal tab (`chrome-extension://<id>/sidepanel.html`). */
export async function openSidebar(context: BrowserContext, id: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  return page;
}

/** Saves `<task>-<step>.png` in light mode and `<task>-<step>-dark.png` in dark mode. */
export async function screens(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SCREENS_DIR, `${name}.png`) });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: join(SCREENS_DIR, `${name}-dark.png`) });
  await page.emulateMedia({ colorScheme: 'light' });
}

/**
 * Reloads the extension like the Reload button in chrome://extensions: loading
 * the same unpacked directory again keeps the id and the stored data, and
 * closes the extension's open pages. (`chrome.runtime.reload()` leaves a
 * command-line-loaded extension disabled; decisions.md T03.)
 */
export async function reloadExtension(context: BrowserContext): Promise<void> {
  const browser = context.browser();
  if (!browser) throw new Error('No browser for this context.');
  const cdp = await browser.newBrowserCDPSession();
  try {
    await cdp.send('Extensions.loadUnpacked', { path: EXTENSION_DIR });
  } finally {
    await cdp.detach();
  }
}
