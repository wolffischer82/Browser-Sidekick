import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startMockLlm, type MockLlm } from '../mock-llm/server';
import {
  extensionId,
  hasPermission,
  launchWithGrantedOrigins,
  newProfile,
  openSidebar,
  screens,
} from './extension';

// T05: add a provider pointing at the local mock server, test the
// connection with a wrong and a right key, save it, see the key masked,
// pick a session model in the composer, and delete all data.
// Screens: test-results/screens/T05-*.png (light and dark).

const KEY = 'sk-mock-e2e-key-7f3a';
const MOCK_ORIGIN = 'http://127.0.0.1/*';

const field = (page: Page, name: string) => page.getByLabel(name, { exact: true });
const modelButton = (page: Page) => page.locator('#model-button');
const title = (page: Page) => page.getByTitle('Rename session');

async function rename(page: Page, name: string): Promise<void> {
  await title(page).click();
  const input = page.getByRole('textbox', { name: 'Session title' });
  await input.fill(name);
  await input.press('Enter');
  await expect(title(page)).toHaveText(name);
}

test('providers: add, test, save, pick a session model, delete all data', async () => {
  const profile = await newProfile();
  let mock: MockLlm | undefined;
  let context: BrowserContext | undefined;
  try {
    mock = await startMockLlm({ apiKey: KEY });
    context = await launchWithGrantedOrigins(profile.dir, [MOCK_ORIGIN]);
    const page = await openSidebar(context, await extensionId(context));
    expect(await hasPermission(page, `${mock.origin}/*`)).toBe(true);

    // No provider yet: the input is disabled and links to settings.
    await expect(page.getByRole('textbox', { name: 'Ask about these pages…' })).toBeDisabled();
    await expect(modelButton(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByText('No providers saved yet.')).toBeVisible();
    await screens(page, 'T05-01-settings-empty');

    // The form per kind: only OpenAI-compatible has an editable base URL.
    await page.getByRole('button', { name: 'Add provider' }).click();
    await expect(field(page, 'Type')).toBeFocused();
    await expect(field(page, 'Base URL')).toHaveValue('https://api.openai.com/v1');
    await expect(field(page, 'Base URL')).toBeEditable();
    await screens(page, 'T05-02-form-openai-compatible');
    await field(page, 'Type').selectOption('anthropic');
    await expect(field(page, 'Name')).toHaveValue('Anthropic');
    await expect(field(page, 'Base URL')).toHaveValue('https://api.anthropic.com');
    await expect(field(page, 'Base URL')).not.toBeEditable();
    await screens(page, 'T05-03-form-anthropic');
    await field(page, 'Type').selectOption('gemini');
    await expect(field(page, 'Name')).toHaveValue('Google Gemini');
    await expect(field(page, 'Base URL')).toHaveValue('https://generativelanguage.googleapis.com');
    await screens(page, 'T05-04-form-gemini');
    await field(page, 'Type').selectOption('openai-compatible');

    // A wrong key: Test connection reports the mapped error.
    await field(page, 'Name').fill('Mock server');
    await field(page, 'Base URL').fill(mock.baseUrl);
    await field(page, 'API key').fill('sk-wrong-key-0000');
    await field(page, 'Default model').fill('mock-large');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(
      page.getByText('The API key was rejected. Check the key and try again.'),
    ).toBeVisible();
    await screens(page, 'T05-05-test-failed-invalid-key');

    // The right key: the model list loads and the test passes.
    await field(page, 'API key').fill(KEY);
    await page.getByRole('button', { name: 'Load models' }).click();
    await expect(page.getByText('Model list loaded.')).toBeVisible();
    await field(page, 'Default model').selectOption('mock-large');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('The connection works.')).toBeVisible();
    await screens(page, 'T05-06-test-ok');
    const test = mock.requests.filter((r) => r.path === '/v1/chat/completions').at(-1);
    expect(test?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(test?.body).toMatchObject({ model: 'mock-large', max_tokens: 1, stream: true });

    // Save: the provider is listed as default, with access (origin pre-granted).
    await page.getByRole('button', { name: 'Save' }).click();
    const list = page.locator('.provider-list');
    await expect(list.getByText('Mock server')).toBeVisible();
    await expect(list.getByText('Default', { exact: true })).toBeVisible();
    await expect(list.getByText('No access')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit “Mock server”' })).toBeFocused();
    await screens(page, 'T05-07-settings-list');

    // The saved key is masked and never rendered in full.
    await page.getByRole('button', { name: 'Edit “Mock server”' }).click();
    await expect(page.getByText(`Saved key: ••••${KEY.slice(-4)}.`)).toBeVisible();
    await expect(field(page, 'API key')).toHaveValue('');
    expect(await page.content()).not.toContain(KEY);
    await screens(page, 'T05-08-masked-key');
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Back in the session: the input is enabled and the session uses the default.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('textbox', { name: 'Ask about these pages…' })).toBeEnabled();
    await expect(modelButton(page)).toHaveAccessibleName('Model: Mock server · mock-large');
    await rename(page, 'Small model session');

    // The header dropdown lists the provider's models; choosing one changes this session.
    await modelButton(page).click();
    const listbox = page.getByRole('listbox', { name: 'Model' });
    await expect(listbox.getByRole('option')).toHaveText(['mock-large', 'mock-small']);
    await expect(listbox.getByRole('option', { name: 'mock-large' })).toBeFocused();
    await screens(page, 'T05-09-model-dropdown-open');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(listbox).toBeHidden();
    await expect(modelButton(page)).toBeFocused();
    await expect(modelButton(page)).toHaveAccessibleName('Model: Mock server · mock-small');

    // A new session starts on the default model; the first one keeps its choice.
    await page.getByRole('button', { name: 'New session' }).click();
    await expect(title(page)).toHaveText('New session');
    await expect(modelButton(page)).toHaveText('mock-large');
    await page.getByRole('button', { name: 'Sessions' }).click();
    await page.getByRole('button', { name: /^Small model session/ }).click();
    await expect(title(page)).toHaveText('Small model session');
    await expect(modelButton(page)).toHaveText('mock-small');

    // Delete all data, including providers.
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Also delete providers and API keys').check();
    await page.getByRole('button', { name: 'Delete all data' }).click();
    await expect(
      page.getByText(
        "Delete all sessions, pinned pages, chat history, providers and API keys? This can't be undone.",
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await screens(page, 'T05-10-delete-all-confirmation');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('All data was deleted.')).toBeVisible();
    await expect(page.getByText('No providers saved yet.')).toBeVisible();
    await screens(page, 'T05-11-after-delete-all');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(title(page)).toHaveText('New session');
    await expect(page.getByRole('textbox', { name: 'Ask about these pages…' })).toBeDisabled();
    await expect(modelButton(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Sessions' }).click();
    await expect(page.locator('.session-item-title')).toHaveText(['New session']);
  } finally {
    await context?.close();
    await mock?.close();
    await profile.remove();
  }
});
