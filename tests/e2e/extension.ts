import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

interface ExtensionPrefs {
  path?: string;
  granted_permissions?: { explicit_host?: string[] };
  active_permissions?: { explicit_host?: string[] };
  runtime_granted_permissions?: { explicit_host?: string[] };
}

/**
 * Grants host permissions to the extension in a profile, as if the user had
 * accepted the browser's permission prompt, which Playwright can't click
 * (headless Chromium keeps it pending). Launches once so Chromium records
 * the extension, then writes the grant into the profile's `Preferences`
 * (Linux Chromium doesn't enforce the preference MACs) and relaunches.
 * Test-only: the shipped build is loaded unchanged (decisions.md T05).
 */
export async function launchWithGrantedOrigins(
  profileDir: string,
  origins: string[],
): Promise<BrowserContext> {
  const first = await launchWithExtension(profileDir);
  await extensionId(first);
  await first.close();

  const file = join(profileDir, 'Default', 'Preferences');
  const prefs = JSON.parse(await readFile(file, 'utf8')) as {
    extensions?: { settings?: Record<string, ExtensionPrefs> };
  };
  const entry = Object.values(prefs.extensions?.settings ?? {}).find(
    (e) => e.path === EXTENSION_DIR,
  );
  if (!entry) throw new Error('The extension is missing from the profile preferences.');
  for (const key of [
    'granted_permissions',
    'active_permissions',
    'runtime_granted_permissions',
  ] as const) {
    const set = (entry[key] ??= {});
    set.explicit_host = [...new Set([...(set.explicit_host ?? []), ...origins])];
  }
  await writeFile(file, JSON.stringify(prefs));
  return launchWithExtension(profileDir);
}

/** Checks from an extension page whether the extension holds `origin`. */
export async function hasPermission(page: Page, origin: string): Promise<boolean> {
  return page.evaluate(async (o) => {
    // Runs in the extension page, where the `chrome` global exists.
    const api = (
      globalThis as unknown as {
        chrome: { permissions: { contains(p: { origins: string[] }): Promise<boolean> } };
      }
    ).chrome;
    return api.permissions.contains({ origins: [o] });
  }, origin);
}

/**
 * Opens the sidebar page in its own popup window, like a side panel that
 * isn't a tab: the current-tab tracker follows normal windows only, so the
 * tabs of the normal window stay the "current tab".
 */
export async function openSidebarWindow(context: BrowserContext, id: string): Promise<Page> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const url = `chrome-extension://${id}/sidepanel.html`;
  const [page] = await Promise.all([
    context.waitForEvent('page', (p) => p.url() === url),
    worker.evaluate(async (u) => {
      const api = (
        globalThis as unknown as {
          chrome: { windows: { create(o: object): Promise<unknown> } };
        }
      ).chrome;
      await api.windows.create({ url: u, type: 'popup', width: 400, height: 720 });
    }, url),
  ]);
  await page.waitForLoadState();
  return page;
}

/** Saves `<task>-<step>.png` in light mode only. */
export async function screen(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SCREENS_DIR, `${name}.png`) });
}
