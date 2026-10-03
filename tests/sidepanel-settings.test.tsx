import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '@/shared/db/repository';
import { DEFAULT_CONTEXT_BUDGET, type ProviderConfig, type ProviderKind } from '@/shared/model';
import { getSettings, updateSettings } from '@/shared/settings';
import { fakePermissions, type FakePermissions } from './helpers/permissions';
import { freshRepository, renderSidebar } from './helpers/sidebar';

let repo: Repository;

afterEach(() => {
  cleanup();
  repo.close();
  vi.unstubAllGlobals();
});

const KEY = 'sk-secret-key-ABCD1234';

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    kind: 'openai-compatible',
    label: 'Local',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: KEY,
    defaultModel: 'gpt-a',
    contextBudget: DEFAULT_CONTEXT_BUDGET,
    cachedModels: ['gpt-a', 'gpt-b'],
    hasAccess: true,
    ...patch,
  };
}

/** A fresh sidebar with `providers` stored and the permission fake returned. */
async function setup(
  providers: ProviderConfig[] = [],
  defaultProviderId: string | null = providers[0]?.id ?? null,
  granted?: string[],
): Promise<FakePermissions> {
  repo = await freshRepository();
  const perms = granted ? fakePermissions(granted) : fakePermissions();
  await updateSettings({ providers, defaultProviderId });
  await renderSidebar(repo);
  return perms;
}

function openSettings(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
}

function back(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
}

const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name, { exact: true });

function type(name: string, value: string): void {
  fireEvent.input(field(name), { target: { value } });
}

function choose(name: string, value: string): void {
  fireEvent.change(field(name), { target: { value } });
}

/**
 * Lets the form's background host-access check finish, as it does while a
 * user fills the form (effects run after paint).
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function save(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

async function stored(): Promise<ProviderConfig[]> {
  return (await getSettings()).providers;
}

async function activeSession() {
  const { activeSessionId } = await getSettings();
  const session = await repo.getSession(activeSessionId ?? '');
  if (!session) throw new Error('No active session');
  return session;
}

function sseBody(deltas: string[]): string {
  return (
    deltas
      .map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  );
}

/** Stubs the global fetch the adapters use; nothing reaches the network. */
function stubFetch(respond: (url: string, init: RequestInit) => Response) {
  const fetchMock = vi.fn((url: string, init: RequestInit) => Promise.resolve(respond(url, init)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('provider form per kind', () => {
  it.each<[ProviderKind, string, string, boolean]>([
    ['openai-compatible', 'OpenAI-compatible', 'https://api.openai.com/v1', true],
    ['anthropic', 'Anthropic', 'https://api.anthropic.com', false],
    ['gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com', false],
  ])(
    '%s: prefilled name and base URL, editable only for OpenAI-compatible',
    async (kind, label, url, editable) => {
      await setup();
      openSettings();
      fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
      choose('Type', kind);
      expect(field('Name').value).toBe(label);
      expect(field('Base URL').value).toBe(url);
      expect(field('Base URL').readOnly).toBe(!editable);
      expect(screen.queryByText(/OLLAMA_ORIGINS/) !== null).toBe(editable);
      expect(screen.queryByText(/Optional for local servers/) !== null).toBe(editable);
    },
  );

  it.each<ProviderKind>(['openai-compatible', 'anthropic', 'gemini'])(
    'adds a %s provider, which becomes the default',
    async (kind) => {
      const perms = await setup();
      openSettings();
      fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
      choose('Type', kind);
      type('Name', `My ${kind}`);
      type('API key', KEY);
      type('Default model', 'model-1');
      type('Context budget (tokens)', '50000');
      await settle();
      save();
      await screen.findByRole('button', { name: `Edit “My ${kind}”` });
      const [saved] = await stored();
      expect(saved).toMatchObject({
        kind,
        label: `My ${kind}`,
        apiKey: KEY,
        defaultModel: 'model-1',
        contextBudget: 50000,
        cachedModels: null,
        hasAccess: true,
      });
      expect((await getSettings()).defaultProviderId).toBe(saved?.id);
      // The native hosts and api.openai.com are covered by the manifest: no prompt.
      expect(perms.requests).toEqual([]);
      expect(screen.getByText('Default')).toBeTruthy();
    },
  );

  it.each<ProviderKind>(['anthropic', 'gemini'])('requires a key for %s', async (kind) => {
    await setup();
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    choose('Type', kind);
    type('Default model', 'm');
    save();
    expect(await screen.findByText('Enter the API key.')).toBeTruthy();
    expect(document.activeElement).toBe(field('API key'));
    expect(field('API key').getAttribute('aria-invalid')).toBe('true');
    expect(await stored()).toEqual([]);
  });

  it('lets an OpenAI-compatible provider go without a key and validates the rest', async () => {
    await setup();
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    type('Name', ' ');
    type('Base URL', 'localhost:1234');
    type('Context budget (tokens)', '10');
    save();
    expect(await screen.findByText('Enter a name.')).toBeTruthy();
    expect(screen.getByText('Enter a URL that starts with http:// or https://.')).toBeTruthy();
    expect(screen.getByText('Choose or enter a model.')).toBeTruthy();
    expect(screen.getByText('Enter a whole number from 1000 to 10000000.')).toBeTruthy();
    expect(screen.queryByText('Enter the API key.')).toBeNull();
    expect(document.activeElement).toBe(field('Name'));
    expect(await stored()).toEqual([]);
  });

  it('Cancel and Escape leave the form without saving', async () => {
    await setup();
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    type('Name', 'Draft');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add provider' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    fireEvent.keyDown(field('Name'), { key: 'Escape' });
    expect(screen.getByText('No providers saved yet.')).toBeTruthy();
    expect(await stored()).toEqual([]);
  });

  it('keeps the kind fixed when editing', async () => {
    await setup([provider()]);
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Edit “Local”' }));
    expect(screen.getByRole('heading', { name: 'Edit provider' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>('Type').disabled).toBe(true);
    expect(document.activeElement).toBe(field('Name'));
  });
});

describe('masked key', () => {
  it('never renders the saved key and keeps it unless a new one is typed', async () => {
    await setup([provider()]);
    openSettings();
    expect(document.body.innerHTML).not.toContain(KEY);
    fireEvent.click(screen.getByRole('button', { name: 'Edit “Local”' }));
    expect(screen.getByText('Saved key: ••••1234. Type a new key to replace it.')).toBeTruthy();
    expect(field('API key').value).toBe('');
    expect(document.body.innerHTML).not.toContain(KEY);

    type('Name', 'Renamed');
    save();
    await screen.findByRole('button', { name: 'Edit “Renamed”' });
    expect((await stored())[0]).toMatchObject({ label: 'Renamed', apiKey: KEY });

    fireEvent.click(screen.getByRole('button', { name: 'Edit “Renamed”' }));
    type('API key', 'sk-new-key-99998888');
    expect(screen.queryByText(/Saved key/)).toBeNull();
    save();
    await screen.findByRole('button', { name: 'Edit “Renamed”' });
    expect((await stored())[0]?.apiKey).toBe('sk-new-key-99998888');
    fireEvent.click(screen.getByRole('button', { name: 'Edit “Renamed”' }));
    expect(screen.getByText('Saved key: ••••8888. Type a new key to replace it.')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('sk-new-key-99998888');
  });
});

describe('host access for a custom origin', () => {
  async function addCustom(baseUrl = 'http://gateway.example:8080/v1') {
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    type('Name', 'Gateway');
    type('Base URL', baseUrl);
    type('Default model', 'gw-model');
    await settle();
    save();
    await screen.findByRole('button', { name: 'Edit “Gateway”' });
  }

  it('asks exactly once and saves with access when granted', async () => {
    const perms = await setup();
    await addCustom();
    expect(perms.requests).toEqual([['http://gateway.example:8080/*']]);
    expect((await stored())[0]).toMatchObject({ hasAccess: true, apiKey: '' });
    expect((await getSettings()).defaultProviderId).toBe((await stored())[0]?.id);
    expect(screen.queryByText('No access')).toBeNull();
  });

  it('saves as "no access" when declined: not default, not in the model menu, input stays disabled', async () => {
    const perms = await setup();
    perms.answer = 'decline';
    await addCustom();
    expect(perms.requests).toHaveLength(1);
    expect((await stored())[0]).toMatchObject({ hasAccess: false });
    expect((await getSettings()).defaultProviderId).toBeNull();
    expect(screen.getByText('No access')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Make “Gateway” the default/ })).toBeNull();
    back();
    expect(screen.queryByRole('button', { name: /^Model:/ })).toBeNull();
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Ask about these pages…' }).disabled,
    ).toBe(true);
  });

  it('treats a refused request like a declined one', async () => {
    const perms = await setup();
    perms.answer = 'throw';
    await addCustom();
    expect((await stored())[0]).toMatchObject({ hasAccess: false });
  });

  it('Grant access asks for that one host and makes the provider usable', async () => {
    const perms = await setup(
      [provider({ id: 'g', label: 'Gateway', baseUrl: 'https://gw.example/v1', hasAccess: false })],
      null,
    );
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    await waitFor(async () => {
      expect((await stored())[0]?.hasAccess).toBe(true);
    });
    expect(perms.requests).toEqual([['https://gw.example/*']]);
    expect((await getSettings()).defaultProviderId).toBe('g');
    await waitFor(() => {
      expect(screen.queryByText('No access')).toBeNull();
    });
  });

  it('does not ask when the origin is already covered', async () => {
    const perms = await setup([], null, ['http://gateway.example/*']);
    await addCustom();
    expect(perms.requests).toEqual([]);
    expect((await stored())[0]?.hasAccess).toBe(true);
  });

  it('shows a revoked native host as "no access" when the sidebar opens', async () => {
    await setup([provider({ id: 'a', kind: 'anthropic', label: 'Claude', baseUrl: '' })], 'a', []);
    await waitFor(async () => {
      expect((await stored())[0]?.hasAccess).toBe(false);
    });
    openSettings();
    expect(screen.getByText('No access')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Grant access' })).toBeTruthy();
  });
});

describe('default provider', () => {
  it('Make default moves the badge', async () => {
    await setup([provider({ id: 'a', label: 'A' }), provider({ id: 'b', label: 'B' })], 'a');
    openSettings();
    const rowOf = (label: string) =>
      screen.getByText(label, { selector: '.provider-label' }).closest('li') as HTMLElement;
    expect(within(rowOf('A')).getByText('Default')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make “B” the default' }));
    await waitFor(() => {
      expect(within(rowOf('B')).queryByText('Default')).toBeTruthy();
    });
    expect(within(rowOf('A')).queryByText('Default')).toBeNull();
    expect((await getSettings()).defaultProviderId).toBe('b');
  });

  it('new sessions start on the default provider and model', async () => {
    await setup(
      [
        provider({ id: 'a', label: 'A', defaultModel: 'gpt-a' }),
        provider({ id: 'b', label: 'B', defaultModel: 'gpt-b' }),
      ],
      'b',
    );
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    await waitFor(async () => {
      expect(await activeSession()).toMatchObject({ providerId: 'b', model: 'gpt-b' });
    });
    expect(screen.getByRole('button', { name: 'Model: B · gpt-b' })).toBeTruthy();
  });
});

describe('Test connection and model list', () => {
  async function openForm() {
    await setup();
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    type('API key', KEY);
    type('Default model', 'gpt-a');
  }

  it('sends a one-token request and reports success', async () => {
    const fetchMock = stubFetch(
      () => new Response(sseBody(['H']), { headers: { 'Content-Type': 'text/event-stream' } }),
    );
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('The connection works.')).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: 'gpt-a',
      max_completion_tokens: 1,
    });
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${KEY}`);
  });

  it('reports success for a model that answers with reasoning only, and shows none of it', async () => {
    const body =
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'Secret thought' } }] })}\n\n` +
      'data: [DONE]\n\n';
    const fetchMock = stubFetch(
      () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    );
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('The connection works.')).toBeTruthy();
    expect(screen.queryByText(/Secret thought/)).toBeNull();
    // The request is the one sent before reasoning existed: no thinking field.
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(init?.body as string)).toEqual({
      model: 'gpt-a',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
      max_completion_tokens: 1,
    });
  });

  it('reports an invalid key', async () => {
    stubFetch(() => new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(
      await screen.findByText('The API key was rejected. Check the key and try again.'),
    ).toBeTruthy();
    expect(screen.queryByText(/bad key/)).toBeNull();
  });

  it("shows the provider's message for a rejected request, with the key removed", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { message: `Unsupported value near ${KEY}` } }), {
          status: 400,
        }),
    );
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(
      await screen.findByText(
        'The provider rejected the request. Check the settings and try again.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/^Provider message: Unsupported value near/)).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('reports a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(
      await screen.findByText(
        "The provider couldn't be reached. Check the base URL and your connection.",
      ),
    ).toBeTruthy();
  });

  it('fills a model dropdown from the list endpoint and caches the list on save', async () => {
    stubFetch(() => Response.json({ data: [{ id: 'gpt-b' }, { id: 'gpt-a' }] }));
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
    expect(await screen.findByText('Model list loaded.')).toBeTruthy();
    const select = screen.getByLabelText<HTMLSelectElement>('Default model');
    expect(select.tagName).toBe('SELECT');
    expect([...select.options].map((o) => o.value)).toEqual(['', 'gpt-a', 'gpt-b']);
    choose('Default model', 'gpt-b');
    save();
    await screen.findByRole('button', { name: /^Edit/ });
    expect((await stored())[0]).toMatchObject({
      defaultModel: 'gpt-b',
      cachedModels: ['gpt-a', 'gpt-b'],
    });
  });

  it('stores what the list says about each model next to the cached list', async () => {
    stubFetch(() =>
      Response.json({
        data: [
          { id: 'gpt-b', supported_parameters: ['temperature'] },
          { id: 'gpt-a', supported_parameters: ['reasoning'] },
          { id: 'gpt-c' },
        ],
      }),
    );
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
    expect(await screen.findByText('Model list loaded.')).toBeTruthy();
    save();
    await screen.findByRole('button', { name: /^Edit/ });
    const [saved] = await stored();
    expect(saved?.cachedModels).toEqual(['gpt-a', 'gpt-b', 'gpt-c']);
    expect(saved?.modelInfo).toEqual({
      'gpt-a': { thinking: 'supported' },
      'gpt-b': { thinking: 'unsupported' },
    });
  });

  describe('editing a provider that has model info', () => {
    const INFO = { 'gpt-a': { thinking: 'supported' as const } };

    async function openEdit() {
      await setup([provider({ modelInfo: INFO })]);
      openSettings();
      fireEvent.click(screen.getByRole('button', { name: /^Edit/ }));
      await settle();
    }

    async function saved() {
      save();
      await screen.findByRole('button', { name: /^Edit/ });
      return (await stored())[0];
    }

    it('keeps both when the list is not touched', async () => {
      await openEdit();
      type('Name', 'Renamed');
      expect(await saved()).toMatchObject({
        label: 'Renamed',
        cachedModels: ['gpt-a', 'gpt-b'],
        modelInfo: INFO,
      });
    });

    it('replaces both when the list is loaded again', async () => {
      stubFetch(() => Response.json({ data: [{ id: 'gpt-a', supported_parameters: [] }] }));
      await openEdit();
      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
      expect(await screen.findByText('Model list loaded.')).toBeTruthy();
      const config = await saved();
      expect(config?.cachedModels).toEqual(['gpt-a']);
      expect(config?.modelInfo).toEqual({ 'gpt-a': { thinking: 'unsupported' } });
    });

    it('clears both when loading the list fails', async () => {
      stubFetch(() => new Response('not found', { status: 404 }));
      await openEdit();
      fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
      await screen.findByText("The model list couldn't be loaded. Type the model name instead.");
      const config = await saved();
      expect(config?.cachedModels).toBeNull();
      expect(config).not.toHaveProperty('modelInfo');
    });

    it('clears both when the base URL changes', async () => {
      await openEdit();
      type('Base URL', 'https://api.openai.com/v2');
      await settle();
      const config = await saved();
      expect(config?.cachedModels).toBeNull();
      expect(config).not.toHaveProperty('modelInfo');
    });
  });

  it('saves a provider cached before model info existed without adding any', async () => {
    await setup([provider()]);
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: /^Edit/ }));
    await settle();
    save();
    await screen.findByRole('button', { name: /^Edit/ });
    const [config] = await stored();
    expect(config?.cachedModels).toEqual(['gpt-a', 'gpt-b']);
    expect(config).not.toHaveProperty('modelInfo');
  });

  it('falls back to free-text entry when listing fails', async () => {
    stubFetch(() => new Response('not found', { status: 404 }));
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
    expect(
      await screen.findByText("The model list couldn't be loaded. Type the model name instead."),
    ).toBeTruthy();
    expect(field('Default model').tagName).toBe('INPUT');
    expect(field('Default model').value).toBe('gpt-a');
  });
});

describe('session model dropdown', () => {
  const providers = [
    provider({ id: 'a', label: 'A', cachedModels: ['a-1', 'a-2'], defaultModel: 'a-1' }),
    provider({ id: 'b', label: 'B', cachedModels: null, defaultModel: 'b-only' }),
    provider({ id: 'x', label: 'X', hasAccess: false, baseUrl: 'https://x.example/v1' }),
  ];

  it('lists every usable provider with its models and changes only this session', async () => {
    await setup(providers, 'a', [
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://generativelanguage.googleapis.com/*',
    ]);
    const first = await activeSession();
    expect(first).toMatchObject({ providerId: 'a', model: 'a-1' });

    fireEvent.click(screen.getByRole('button', { name: 'Model: A · a-1' }));
    const listbox = screen.getByRole('listbox', { name: 'Model' });
    const groups = within(listbox).getAllByRole('group');
    expect(
      groups
        .map((g) => g.getAttribute('aria-labelledby'))
        .map((id) => document.getElementById(id ?? '')?.textContent),
    ).toEqual(['A', 'B']);
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['a-1', 'a-2', 'b-only']);
    expect(within(listbox).getByRole('option', { name: 'a-1' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(document.activeElement?.textContent).toBe('a-1');

    fireEvent.click(within(listbox).getByRole('option', { name: 'b-only' }));
    await waitFor(async () => {
      expect(await activeSession()).toMatchObject({ providerId: 'b', model: 'b-only' });
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Model: B · b-only' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    await waitFor(async () => {
      expect((await activeSession()).id).not.toBe(first.id);
    });
    expect(await activeSession()).toMatchObject({ providerId: 'a', model: 'a-1' });
    expect(await repo.getSession(first.id)).toMatchObject({ providerId: 'b', model: 'b-only' });
  });

  it('is keyboard-operable: arrows, Enter, Escape', async () => {
    await setup(providers, 'a');
    const button = screen.getByRole('button', { name: 'Model: A · a-1' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const listbox = screen.getByRole('listbox');
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('a-1');
    });
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('a-2');
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('b-only');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    expect(document.activeElement?.textContent).toBe('a-1');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(listbox.isConnected).toBe(false);

    fireEvent.click(button);
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('a-1');
    });
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    await waitFor(async () => {
      expect(await activeSession()).toMatchObject({ providerId: 'a', model: 'a-2' });
    });
  });

  it('is hidden while no provider is usable', async () => {
    await setup();
    expect(screen.queryByRole('button', { name: /^Model:/ })).toBeNull();
  });

  it('gives an existing session without a provider the new default', async () => {
    await setup();
    expect((await activeSession()).providerId).toBeNull();
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    type('Default model', 'gpt-a');
    save();
    await screen.findByRole('button', { name: /^Edit/ });
    back();
    await waitFor(async () => {
      expect(await activeSession()).toMatchObject({ model: 'gpt-a' });
    });
    expect(screen.queryByText(/provider was deleted/)).toBeNull();
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Ask about these pages…' }).disabled,
    ).toBe(false);
  });
});

describe('deleting a provider', () => {
  async function deleteProviderNamed(label: string) {
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: `Delete “${label}”` }));
    expect(
      screen.getByText(
        'Delete this provider and its API key? Sessions that use it switch to the default provider.',
      ),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(async () => {
      expect((await stored()).some((p) => p.label === label)).toBe(false);
    });
    back();
  }

  it('moves the session to the default with a notice', async () => {
    await setup(
      [
        provider({ id: 'a', label: 'A', defaultModel: 'a-1' }),
        provider({ id: 'b', label: 'B', defaultModel: 'b-1' }),
      ],
      'a',
    );
    const session = await activeSession();
    await repo.updateSession(session.id, { providerId: 'b', model: 'b-1' });
    const other = await repo.createSession({ providerId: 'b', model: 'b-1', title: 'Other' });
    // Reopen so the sidebar shows the session on B.
    cleanup();
    await renderSidebar(repo);
    expect(screen.getByRole('button', { name: 'Model: B · b-1' })).toBeTruthy();

    await deleteProviderNamed('B');
    expect(
      await screen.findByText(
        "This session's provider was deleted. It now uses the default provider.",
      ),
    ).toBeTruthy();
    expect(await activeSession()).toMatchObject({ providerId: 'a', model: 'a-1' });

    // Another session on B moves when it is opened, with the notice.
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Other/ }));
    await waitFor(async () => {
      expect(await repo.getSession(other.id)).toMatchObject({ providerId: 'a', model: 'a-1' });
    });
    expect(
      screen.getByText("This session's provider was deleted. It now uses the default provider."),
    ).toBeTruthy();

    // Choosing a model clears the notice.
    fireEvent.click(screen.getByRole('button', { name: 'Model: A · a-1' }));
    fireEvent.click(screen.getByRole('option', { name: 'gpt-b' }));
    await waitFor(() => {
      expect(screen.queryByText(/provider was deleted/)).toBeNull();
    });
  });

  it('says so when no provider is left', async () => {
    await setup([provider({ id: 'a', label: 'A' })], 'a');
    await deleteProviderNamed('A');
    expect(
      await screen.findByText(
        "This session's provider was deleted. Add a provider in settings to ask questions.",
      ),
    ).toBeTruthy();
    expect(await activeSession()).toMatchObject({ providerId: null, model: null });
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Ask about these pages…' }).disabled,
    ).toBe(true);
  });

  it('Cancel keeps the provider', async () => {
    await setup([provider({ id: 'a', label: 'A' })], 'a');
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Delete “A”' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete “A”' }));
    expect(await stored()).toHaveLength(1);
  });
});

describe('Delete all data', () => {
  async function fill() {
    const s = await activeSession();
    await repo.addPin(s.id, { url: 'https://a.example/', title: 'A', kind: 'page' });
    await repo.addMessage(s.id, { role: 'user', text: 'Hi' });
    await repo.createSession({ providerId: 'a', model: 'gpt-a', title: 'Second' });
  }

  async function deleteAll(includeProviders: boolean) {
    openSettings();
    if (includeProviders)
      fireEvent.click(screen.getByLabelText('Also delete providers and API keys'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete all data' }));
    expect(
      screen.getByText(
        includeProviders
          ? "Delete all sessions, pinned pages, chat history, providers and API keys? This can't be undone."
          : "Delete all sessions, pinned pages and chat history? This can't be undone.",
      ),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('All data was deleted.')).toBeTruthy();
  }

  it('empties IndexedDB and keeps providers', async () => {
    await setup([provider({ id: 'a' })], 'a');
    const before = await activeSession();
    await fill();
    await deleteAll(false);
    const sessions = await repo.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).not.toBe(before.id);
    expect(sessions[0]).toMatchObject({ providerId: 'a', model: 'gpt-a' });
    expect(await repo.listPins(before.id)).toEqual([]);
    expect(await repo.listMessages(before.id)).toEqual([]);
    expect((await getSettings()).activeSessionId).toBe(sessions[0]?.id);
    expect(await stored()).toHaveLength(1);
  });

  it('removes providers and keys too when ticked', async () => {
    await setup([provider({ id: 'a' })], 'a');
    await fill();
    await deleteAll(true);
    expect(await getSettings()).toMatchObject({ providers: [], defaultProviderId: null });
    expect(await repo.listSessions()).toHaveLength(1);
    expect(screen.getByText('No providers saved yet.')).toBeTruthy();
    back();
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Ask about these pages…' }).disabled,
    ).toBe(true);
    expect(screen.getByTitle('Rename session').textContent).toBe('New session');
  });

  it('Cancel deletes nothing', async () => {
    await setup([provider({ id: 'a' })], 'a');
    await fill();
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete all data' }));
    expect(await repo.listSessions()).toHaveLength(2);
  });
});

describe('input', () => {
  it('stays disabled until a usable provider exists', async () => {
    const perms = await setup(
      [provider({ id: 'g', baseUrl: 'https://gw.example/v1', hasAccess: false })],
      null,
    );
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Ask about these pages…',
    });
    expect(input.disabled).toBe(true);
    perms.grant('https://gw.example/*');
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Ask about these pages…' })
          .disabled,
      ).toBe(false);
    });
  });
});
