import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  extensionId,
  launchWithExtension,
  newProfile,
  openSidebar,
  reloadExtension,
  screens,
} from './extension';

// T03: create sessions, rename, switch, delete; the active session survives
// an extension reload and a browser restart. Screens: test-results/screens/T03-*.png.

const title = (page: Page) => page.getByTitle('Rename session');
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Sessions' });
const rows = (page: Page) => drawer(page).locator('.session-item-title');

async function rename(page: Page, name: string): Promise<void> {
  await title(page).click();
  const input = page.getByRole('textbox', { name: 'Session title' });
  await input.fill(name);
  await input.press('Enter');
  await expect(title(page)).toHaveText(name);
}

async function openDrawer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sessions' }).click();
  await expect(drawer(page)).toBeVisible();
}

test('sessions: create, rename, switch, delete and persist', async () => {
  const profile = await newProfile();
  let context: BrowserContext | undefined;
  try {
    context = await launchWithExtension(profile.dir);
    const id = await extensionId(context);
    let page = await openSidebar(context, id);

    // First run: one empty session with the fallback title.
    await expect(title(page)).toHaveText('New session');
    // No pins; the one row is the current tab (T06), here not accessible.
    await expect(page.getByRole('button', { name: 'Session tabs (1)' })).toBeVisible();
    await expect(page.getByText('No pinned pages yet.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Ask about these pages…' })).toBeDisabled();
    await screens(page, 'T03-01-empty-first-run');

    // Rename with the keyboard only.
    await page.getByRole('button', { name: 'Sessions' }).focus();
    await page.keyboard.press('Tab');
    await expect(title(page)).toBeFocused();
    await page.keyboard.press('Enter');
    const input = page.getByRole('textbox', { name: 'Session title' });
    await expect(input).toBeFocused();
    await page.keyboard.type('Pricing research');
    await screens(page, 'T03-02-rename-in-progress');
    await page.keyboard.press('Enter');
    await expect(title(page)).toHaveText('Pricing research');
    await expect(title(page)).toBeFocused();

    // Two more sessions; the newest stays on the fallback title.
    await page.getByRole('button', { name: 'New session' }).click();
    await expect(title(page)).toHaveText('New session');
    await rename(page, 'Travel plans');
    await page.getByRole('button', { name: 'New session' }).click();
    await expect(title(page)).toHaveText('New session');

    await openDrawer(page);
    await expect(rows(page)).toHaveText(['New session', 'Travel plans', 'Pricing research']);
    await expect(drawer(page).locator('.session-item-meta').first()).toHaveText('now · 0 pins');
    await screens(page, 'T03-03-drawer-several-sessions');

    // Switch with the keyboard: focus lands on Close, then Tab goes row, delete, row.
    await expect(drawer(page).getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(drawer(page).getByRole('button', { name: /^Travel plans/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toBeHidden();
    await expect(title(page)).toHaveText('Travel plans');
    await expect(page.getByRole('button', { name: 'Sessions' })).toBeFocused();

    // Delete another session: confirmation, then Cancel, then Delete.
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Delete “Pricing research”' }).click();
    await expect(
      drawer(page).getByText('Delete this session with its pins and messages?'),
    ).toBeVisible();
    await expect(drawer(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await screens(page, 'T03-04-delete-confirmation');
    await page.keyboard.press('Escape');
    await expect(rows(page)).toHaveCount(3);
    await expect(drawer(page)).toBeVisible();
    await drawer(page).getByRole('button', { name: 'Delete “Pricing research”' }).click();
    await drawer(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(rows(page)).toHaveText(['New session', 'Travel plans']);
    await expect(title(page)).toHaveText('Travel plans');

    // Delete the active session: switches to the most recent remaining one.
    await drawer(page).getByRole('button', { name: 'Delete “Travel plans”' }).click();
    await drawer(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(rows(page)).toHaveText(['New session']);
    await expect(title(page)).toHaveText('New session');
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeHidden();
    await rename(page, 'Survivor');

    // Delete a newer active session: back to the remaining one.
    await page.getByRole('button', { name: 'New session' }).click();
    await rename(page, 'Temporary');
    await openDrawer(page);
    await drawer(page).getByRole('button', { name: 'Delete “Temporary”' }).click();
    await drawer(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(rows(page)).toHaveText(['Survivor']);
    await expect(title(page)).toHaveText('Survivor');
    await page.keyboard.press('Escape');

    // Extension reload: the active session is restored.
    await reloadExtension(context);
    await expect.poll(() => page.isClosed()).toBe(true);
    page = await openSidebar(context, id);
    await expect(title(page)).toHaveText('Survivor');

    // Browser restart on the same profile.
    await context.close();
    context = await launchWithExtension(profile.dir);
    page = await openSidebar(context, await extensionId(context));
    await expect(title(page)).toHaveText('Survivor');
    await openDrawer(page);
    await expect(rows(page)).toHaveText(['Survivor']);
  } finally {
    await context?.close();
    await profile.remove();
  }
});

test('sessions: deleting the only session starts a new empty one', async () => {
  const profile = await newProfile();
  const context = await launchWithExtension(profile.dir);
  try {
    const page = await openSidebar(context, await extensionId(context));
    await rename(page, 'Only');
    await openDrawer(page);
    await drawer(page).getByRole('button', { name: 'Delete “Only”' }).click();
    await drawer(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(rows(page)).toHaveText(['New session']);
    await expect(title(page)).toHaveText('New session');
  } finally {
    await context.close();
    await profile.remove();
  }
});
