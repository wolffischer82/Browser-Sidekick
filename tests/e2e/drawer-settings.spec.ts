import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startMockLlm, type MockLlm } from '../mock-llm/server';
import {
  extensionId,
  launchWithExtension,
  launchWithGrantedOrigins,
  newProfile,
  openSidebar,
  screens,
} from './extension';

// T20: the sessions drawer grouped by date, with hover delete and New
// session; settings with provider cards, the page access dot and the
// version footer. Screens: test-results/screens/T20-*.png (light and dark).

const KEY = 'sk-mock-e2e-key-7f3a';
const MOCK_ORIGIN = 'http://127.0.0.1/*';

const title = (page: Page) => page.getByTitle('Rename session');
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Sessions' });
const field = (page: Page, name: string) => page.getByLabel(name, { exact: true });

/** Wednesday 7 October 2026, 12:00 local time; the week started on Monday the 5th. */
const NOW = new Date(2026, 9, 7, 12, 0);
const at = (month: number, day: number, hour: number, minute = 0) =>
  new Date(2026, month, day, hour, minute).getTime();

/** Last activity per session title, most recent first. */
const ACTIVITY: [string, number][] = [
  ['Rust async runtimes', at(9, 7, 11, 58)],
  ['Flat hunting in Leipzig', at(9, 7, 0, 5)],
  ['Postgres indexing', at(9, 6, 23, 50)],
  ['Side panel API notes', at(9, 5, 0, 10)],
  ['Espresso grinders compared', at(9, 4, 23, 55)],
  ['Trip planning: Lisbon', at(8, 14, 9)],
];

async function rename(page: Page, name: string): Promise<void> {
  await title(page).click();
  const input = page.getByRole('textbox', { name: 'Session title' });
  await input.fill(name);
  await input.press('Enter');
  await expect(title(page)).toHaveText(name);
}

/** Sets each named session's last activity in IndexedDB, from the sidebar page. */
async function setActivity(page: Page, times: [string, number][]): Promise<void> {
  await page.evaluate(async (entries) => {
    const wanted = new Map(entries);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('sidekick');
      open.onsuccess = () => {
        resolve(open.result);
      };
      open.onerror = () => {
        reject(new Error('open failed'));
      };
    });
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const all = await new Promise<{ title: string; updatedAt: number }[]>((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => {
        resolve(request.result as { title: string; updatedAt: number }[]);
      };
    });
    for (const session of all) {
      const time = wanted.get(session.title);
      if (time !== undefined) store.put({ ...session, updatedAt: time });
    }
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => {
        resolve();
      };
    });
    db.close();
  }, times);
}

async function openDrawer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sessions' }).click();
  await expect(drawer(page)).toBeVisible();
}

/** Group labels and their row titles, as shown. */
async function groups(page: Page): Promise<[string, string[]][]> {
  return drawer(page)
    .locator('.session-group')
    .evaluateAll((sections) =>
      sections.map((section): [string, string[]] => [
        section.querySelector('h3')?.textContent ?? '',
        [...section.querySelectorAll('.session-item-title')].map((t) => t.textContent),
      ]),
    );
}

const row = (page: Page, name: string) =>
  drawer(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: `Delete “${name}”` }) });

test('drawer: groups by date, delete on hover and focus, New session', async () => {
  const profile = await newProfile();
  let context: BrowserContext | undefined;
  try {
    context = await launchWithExtension(profile.dir);
    // A fixed clock in every page of the profile, so the groups don't depend
    // on the day the suite runs.
    await context.clock.setFixedTime(NOW);
    const page = await openSidebar(context, await extensionId(context));
    expect(await page.evaluate(() => [new Date().getDay(), new Date().getHours()])).toEqual([
      3, 12,
    ]);

    // Six sessions, oldest first, so the last one is active.
    await rename(page, ACTIVITY[5]?.[0] ?? '');
    for (const [name] of ACTIVITY.slice(0, 5).reverse()) {
      await page.getByRole('button', { name: 'New session' }).click();
      await expect(title(page)).toHaveText('New session');
      await rename(page, name);
    }
    await setActivity(page, ACTIVITY);

    await openDrawer(page);
    expect(await groups(page)).toEqual([
      ['Today', ['Rust async runtimes', 'Flat hunting in Leipzig']],
      ['This week', ['Postgres indexing', 'Side panel API notes']],
      ['Earlier', ['Espresso grinders compared', 'Trip planning: Lisbon']],
    ]);
    await expect(drawer(page).locator('.session-item-meta').first()).toHaveText(
      '2 minutes ago · 0 pins',
    );

    // The active row: accent-soft fill and the dot.
    const active = drawer(page).locator('.session-item[aria-current="true"]');
    await expect(active).toContainText('Rust async runtimes');
    await expect(active.locator('.session-item-dot')).toBeVisible();
    await expect(drawer(page).locator('.session-item-dot')).toHaveCount(1);
    expect(await drawer(page).evaluate((d) => d.getBoundingClientRect().width)).toBe(320);
    await screens(page, 'T20-01-drawer');

    // Delete shows on hover only, for every row, active or not.
    const deletePostgres = drawer(page).getByRole('button', { name: 'Delete “Postgres indexing”' });
    const box = async () => (await deletePostgres.boundingBox())?.width ?? 0;
    expect(await box()).toBeLessThanOrEqual(1);
    await row(page, 'Postgres indexing').hover();
    expect(await box()).toBe(30);
    await screens(page, 'T20-02-row-hovered');
    await row(page, 'Rust async runtimes').hover();
    await expect(
      drawer(page).getByRole('button', { name: 'Delete “Rust async runtimes”' }),
    ).toBeVisible();
    expect(await box()).toBeLessThanOrEqual(1);

    // And on keyboard focus: Close, New session, the first row, its delete.
    await page.mouse.move(0, 700);
    await drawer(page).getByRole('button', { name: 'Close' }).focus();
    await page.keyboard.press('Tab');
    await expect(drawer(page).getByRole('button', { name: 'New session' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const deleteFirst = drawer(page).getByRole('button', {
      name: 'Delete “Rust async runtimes”',
    });
    await expect(deleteFirst).toBeFocused();
    expect((await deleteFirst.boundingBox())?.width).toBe(30);
    await screens(page, 'T20-03-delete-focused');

    // Delete one: the confirm card replaces the row.
    await row(page, 'Postgres indexing').hover();
    await deletePostgres.click();
    const card = drawer(page).getByRole('group', { name: 'Postgres indexing' });
    await expect(card.getByText('Delete this session with its pins and messages?')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await screens(page, 'T20-04-delete-confirm');
    await card.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(card).toBeHidden();
    // The list reloads after the delete.
    await expect
      .poll(() => groups(page))
      .toEqual([
        ['Today', ['Rust async runtimes', 'Flat hunting in Leipzig']],
        ['This week', ['Side panel API notes']],
        ['Earlier', ['Espresso grinders compared', 'Trip planning: Lisbon']],
      ]);

    // New session from the drawer: starts one, shows it and closes the drawer.
    await drawer(page).getByRole('button', { name: 'New session' }).click();
    await expect(drawer(page)).toBeHidden();
    await expect(title(page)).toHaveText('New session');
    await expect(page.getByRole('button', { name: 'Sessions' })).toBeFocused();
    await openDrawer(page);
    expect((await groups(page))[0]).toEqual([
      'Today',
      ['New session', 'Rust async runtimes', 'Flat hunting in Leipzig'],
    ]);
    await expect(drawer(page).locator('.session-item[aria-current="true"]')).toContainText(
      'New session',
    );

    // Just after midnight on the following Monday, everything is earlier.
    await context.clock.setFixedTime(new Date(2026, 9, 12, 0, 1));
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await openDrawer(page);
    expect((await groups(page)).map(([label]) => label)).toEqual(['Earlier']);
  } finally {
    await context?.close();
    await profile.remove();
  }
});

test('settings: provider cards, add and edit against the mock LLM, access dot, version', async () => {
  const profile = await newProfile();
  let mock: MockLlm | undefined;
  let context: BrowserContext | undefined;
  try {
    mock = await startMockLlm({ apiKey: KEY });
    context = await launchWithGrantedOrigins(profile.dir, [MOCK_ORIGIN]);
    const page = await openSidebar(context, await extensionId(context));
    const version = await page.evaluate(
      () =>
        (
          globalThis as unknown as {
            chrome: { runtime: { getManifest: () => { version: string } } };
          }
        ).chrome.runtime.getManifest().version,
    );

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('.settings-footer')).toHaveText(`Browser Sidekick ${version}`);
    await expect(page.locator('.settings-footer')).toHaveCSS('font-family', /Geist Mono/);

    // Page access: not allowed, shown with the warning dot.
    const access = page.getByRole('region', { name: 'Page access' });
    await expect(access.getByText('Not allowed')).toBeVisible();
    const warning = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--warning').trim(),
    );
    const dotColour = await access
      .locator('.state-dot')
      .evaluate((dot) => getComputedStyle(dot).backgroundColor);
    expect(dotColour).toBe(
      await page.evaluate((hex) => {
        const probe = document.createElement('span');
        probe.style.color = hex;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      }, warning),
    );

    // Add a provider against the mock server.
    await page.getByRole('button', { name: 'Add provider' }).click();
    await expect(field(page, 'Type')).toBeFocused();
    await field(page, 'Name').fill('mock server');
    await field(page, 'Base URL').fill(mock.baseUrl);
    await field(page, 'API key').fill(KEY);
    await page.getByRole('button', { name: 'Load models' }).click();
    await expect(page.getByText('Model list loaded.')).toBeVisible();
    await field(page, 'Default model').selectOption('mock-large');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('The connection works.')).toBeVisible();
    await screens(page, 'T20-05-provider-form');
    await page.getByRole('button', { name: 'Save' }).click();

    // The row: letter tile, name, Default badge, type and model in mono.
    const providerRow = page.locator('.provider-row').filter({ hasText: 'mock server' });
    await expect(providerRow.locator('.provider-tile')).toHaveText('M');
    await expect(providerRow.getByText('Default', { exact: true })).toBeVisible();
    await expect(providerRow.locator('.provider-meta')).toHaveText(
      'OpenAI-compatible · mock-large',
    );
    await expect(providerRow.locator('.provider-model')).toHaveCSS('font-family', /Geist Mono/);
    await screens(page, 'T20-06-settings');

    // Edit: rename and change the default model.
    await page.getByRole('button', { name: 'Edit “mock server”' }).click();
    await expect(page.getByRole('form', { name: 'Edit provider' })).toBeVisible();
    await field(page, 'Name').fill('Zeta mock');
    await field(page, 'Default model').selectOption('mock-small');
    await screens(page, 'T20-07-provider-form-edit');
    await page.getByRole('button', { name: 'Save' }).click();
    const edited = page.locator('.provider-row').filter({ hasText: 'Zeta mock' });
    await expect(edited.locator('.provider-tile')).toHaveText('Z');
    await expect(edited.locator('.provider-meta')).toHaveText('OpenAI-compatible · mock-small');
    await expect(page.getByRole('button', { name: 'Edit “Zeta mock”' })).toBeFocused();

    // The provider delete confirm, restyled; Cancel keeps it.
    await page.getByRole('button', { name: 'Delete “Zeta mock”' }).click();
    await expect(page.getByRole('group', { name: 'Zeta mock' })).toBeVisible();
    await screens(page, 'T20-08-provider-delete-confirm');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(edited).toBeVisible();

    // Nothing in settings overflows the 400 px panel.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      400,
    );
  } finally {
    await context?.close();
    await mock?.close();
    await profile.remove();
  }
});
