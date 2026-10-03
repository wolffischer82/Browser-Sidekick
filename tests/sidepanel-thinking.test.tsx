import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { App } from '@/entrypoints/sidepanel/App';
import type { Repository } from '@/shared/db/repository';
import {
  DEFAULT_CONTEXT_BUDGET,
  type ModelInfo,
  type ProviderConfig,
  type ThinkingLevel,
} from '@/shared/model';
import { getSettings, updateSettings } from '@/shared/settings';
import { readMessages, type Locale } from './helpers/i18n';
import { controlledResponse, jsonResponse } from './helpers/llm-fetch';
import { NATIVE_HOSTS, fakePermissions } from './helpers/permissions';
import { freshRepository, renderSidebar, titleButton } from './helpers/sidebar';

// The thinking-level control in the composer and what it sends
// (specs/thinking-levels.md 4.1, 4.3, 4.6, T15), with the real adapters
// behind a stubbed `fetch`: nothing reaches the network.

const KEY = 'sk-thinking-test-KEY-4321';
const PIN_TEXT = 'Sleeper trains now run from Vienna to Amsterdam.';
const REJECTED =
  "This model doesn't accept a thinking level. Set thinking to Default and try again.";
const PROVIDER_TEXT = "Unsupported parameter: 'reasoning_effort' is not supported here.";

interface Call {
  url: string;
  body: Record<string, unknown>;
}

let repo: Repository;
let calls: Call[];
let responders: (() => Response)[];

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    kind: 'openai-compatible',
    label: 'Local',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: KEY,
    defaultModel: 'plain',
    contextBudget: DEFAULT_CONTEXT_BUDGET,
    cachedModels: ['plain', 'thinks', 'cannot'],
    modelInfo: { thinks: { thinking: 'supported' }, cannot: { thinking: 'unsupported' } },
    hasAccess: true,
    ...patch,
  };
}

function sse(body: string): Response {
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

/** A short streamed answer in the format of the provider the URL belongs to. */
function answer(url: string, text: string): Response {
  if (url.endsWith('/v1/messages')) {
    const delta = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } };
    return sse(
      `event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n` +
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
    );
  }
  if (url.includes(':streamGenerateContent')) {
    const chunk = { candidates: [{ content: { role: 'model', parts: [{ text }] }, index: 0 }] };
    return sse(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  return sse(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
  );
}

const isCompletion = (url: string) =>
  url.endsWith('/chat/completions') ||
  url.endsWith('/v1/messages') ||
  url.includes(':streamGenerateContent');

/** The browser fakes; `freshRepository` resets them, so this runs after it. */
function fakes(): void {
  fakePermissions([...NATIVE_HOSTS, '<all_urls>']);
  vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 1 } as never);
  // No current tab: the requests carry the pin only.
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([] as never);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      if (!isCompletion(url)) return Promise.resolve(new Response('', { status: 404 }));
      calls.push({
        url,
        body: JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<
          string,
          unknown
        >,
      });
      const next = responders.shift();
      return Promise.resolve(next ? next() : answer(url, 'Fine.'));
    }),
  );
}

interface OpenOptions {
  providers?: ProviderConfig[];
  model?: string | null;
  level?: ThinkingLevel | null;
  locale?: Locale;
  /** Leave the fallback title, so the first answer asks for a title. */
  untitled?: boolean;
}

/** A session with one ready pin on `model` of provider `p1`, and the sidebar rendered. */
async function open(options: OpenOptions = {}): Promise<string> {
  const locale = options.locale ?? 'en';
  repo = await freshRepository(locale);
  fakes();
  const providers = options.providers ?? [provider()];
  const usable = providers.length > 0;
  const model = options.model === undefined ? (providers[0]?.defaultModel ?? null) : options.model;
  const session = await repo.createSession({ providerId: usable ? 'p1' : null, model });
  if (options.level !== undefined) {
    await repo.updateSession(session.id, { thinkingLevel: options.level });
  }
  // A named session asks for no title: every request is then an Ask or a Summarize.
  if (!options.untitled) await repo.setSessionTitle(session.id, 'Trains', 'user');
  const pin = await repo.addPin(session.id, {
    url: 'https://news.example/trains',
    title: 'Night trains return',
    kind: 'page',
  });
  await repo.updatePin(pin.id, { status: 'ready', text: PIN_TEXT });
  await updateSettings({
    providers,
    defaultProviderId: usable ? 'p1' : null,
    activeSessionId: session.id,
  });
  await show(locale);
  return session.id;
}

async function show(locale: Locale = 'en'): Promise<void> {
  if (locale === 'en') {
    await renderSidebar(repo);
    return;
  }
  render(<App repository={Promise.resolve(repo)} />);
  await screen.findByRole('button', { name: readMessages(locale).summarize?.message });
}

const control = () => document.getElementById('thinking-button');
const controlText = () => control()?.textContent ?? null;
const listbox = () => screen.getByRole('listbox', { name: 'Thinking level' });
const optionTexts = () =>
  within(listbox())
    .getAllByRole('option')
    .map((o) => o.textContent);
const selected = () =>
  within(listbox())
    .getAllByRole('option')
    .filter((o) => o.getAttribute('aria-selected') === 'true')
    .map((o) => o.textContent);

/** Picks a level through the control, by mouse. */
async function choose(name: string): Promise<void> {
  fireEvent.click(control() as HTMLElement);
  fireEvent.click(within(listbox()).getByRole('option', { name }));
  await waitFor(() => {
    expect(controlText()).toBe(name);
  });
}

async function chooseModel(name: string): Promise<void> {
  fireEvent.click(document.getElementById('model-button') as HTMLElement);
  fireEvent.click(
    within(screen.getByRole('listbox', { name: 'Model' })).getByRole('option', { name }),
  );
  await waitFor(() => {
    expect(document.getElementById('model-button')?.textContent).toBe(name);
  });
}

const input = () =>
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Ask about these pages…' });

function ask(question: string): void {
  fireEvent.input(input(), { target: { value: question } });
  fireEvent.keyDown(input(), { key: 'Enter' });
}

const answers = () => screen.queryAllByRole('article', { name: 'Answer' });
const pause = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `count` answers are shown and nothing streams. */
async function finished(count: number): Promise<void> {
  await waitFor(() => {
    expect(answers()).toHaveLength(count);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
}

const storedLevel = async (id: string) => (await repo.getSession(id))?.thinkingLevel;
const isTitleRequest = (call: Call) => JSON.stringify(call.body).includes('Write a title');

beforeEach(() => {
  calls = [];
  responders = [];
});

afterEach(() => {
  cleanup();
  repo.close();
  // Anything still on its way fails here instead of reaching the network.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('The test is over.'))),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('the thinking-level control', () => {
  it('reads "Default" for a session without a level, next to the model menu', async () => {
    await open();
    const button = control() as HTMLElement;
    expect(button.textContent).toBe('Default');
    expect(button.getAttribute('aria-label')).toBe('Thinking level: Default');
    expect(screen.getByRole('button', { name: 'Thinking level: Default' })).toBe(button);
    expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.hasAttribute('disabled')).toBe(false);
    // The level's name only, after a lightbulb; the name keeps the label (redesign spec 5.4).
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('title')).toBe('Thinking level: Default');
    // In the composer's toolbar, straight after the model menu, before Summarize and Send.
    const toolbar = button.closest('.composer-toolbar');
    expect(toolbar?.closest('header')).toBeNull();
    expect([...(toolbar?.querySelectorAll('button') ?? [])].map((b) => b.id)).toEqual([
      'model-button',
      'thinking-button',
      'summarize-button',
      'send-button',
    ]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('lists Default, Low, Medium and High and marks the current one', async () => {
    await open({ level: 'medium' });
    expect(controlText()).toBe('Medium');
    fireEvent.click(control() as HTMLElement);
    expect(control()?.getAttribute('aria-expanded')).toBe('true');
    expect(optionTexts()).toEqual(['Default', 'Low', 'Medium', 'High']);
    expect(selected()).toEqual(['Medium']);
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('Medium');
    });
  });

  it('changes the level of this session, closes and returns focus to the button', async () => {
    const id = await open();
    const other = await repo.createSession({ providerId: 'p1', model: 'plain' });
    fireEvent.click(control() as HTMLElement);
    expect(selected()).toEqual(['Default']);
    fireEvent.click(within(listbox()).getByRole('option', { name: 'High' }));
    await waitFor(() => {
      expect(controlText()).toBe('High');
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(control());
    expect(control()?.getAttribute('aria-label')).toBe('Thinking level: High');
    expect(await storedLevel(id)).toBe('high');
    expect(await storedLevel(other.id)).toBeUndefined();
    // The model and the title are untouched, and nothing was sent.
    expect(await repo.getSession(id)).toMatchObject({
      providerId: 'p1',
      model: 'plain',
      title: 'Trains',
    });
    expect(calls).toEqual([]);

    for (const [name, level] of [
      ['Low', 'low'],
      ['Medium', 'medium'],
      ['Default', null],
    ] as const) {
      await choose(name);
      expect(await storedLevel(id)).toBe(level);
    }
  });

  it('choosing the current level changes and writes nothing', async () => {
    const id = await open({ level: 'low' });
    const update = vi.spyOn(repo, 'updateSession');
    fireEvent.click(control() as HTMLElement);
    fireEvent.click(within(listbox()).getByRole('option', { name: 'Low' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    await pause();
    expect(update).not.toHaveBeenCalled();
    expect(await storedLevel(id)).toBe('low');
  });

  it('keeps the level when the sidebar is reopened', async () => {
    const id = await open();
    await choose('High');
    cleanup();
    await show();
    expect(controlText()).toBe('High');
    expect(await storedLevel(id)).toBe('high');
  });

  it('a new session starts at Default, and switching back shows the stored level', async () => {
    const id = await open();
    await choose('High');
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    await waitFor(() => {
      expect(titleButton().textContent).toBe('New session');
    });
    expect(controlText()).toBe('Default');
    const fresh = (await getSettings()).activeSessionId ?? '';
    expect(fresh).not.toBe(id);
    expect(await storedLevel(fresh)).toBeUndefined();
    await choose('Low');

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Trains/ }));
    await waitFor(() => {
      expect(controlText()).toBe('High');
    });
    expect(await storedLevel(id)).toBe('high');
    expect(await storedLevel(fresh)).toBe('low');
  });

  it('is keyboard-operable: arrows, Home, End, Enter, Space, Escape, Tab', async () => {
    const id = await open();
    const button = control() as HTMLElement;
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('Default');
    });
    const focused = () => document.activeElement as Element;
    fireEvent.keyDown(focused(), { key: 'ArrowDown' });
    expect(focused().textContent).toBe('Low');
    fireEvent.keyDown(focused(), { key: 'End' });
    expect(focused().textContent).toBe('High');
    fireEvent.keyDown(focused(), { key: 'ArrowDown' });
    expect(focused().textContent).toBe('High');
    fireEvent.keyDown(focused(), { key: 'Home' });
    expect(focused().textContent).toBe('Default');
    fireEvent.keyDown(focused(), { key: 'ArrowUp' });
    expect(focused().textContent).toBe('Default');

    // Escape closes without a change and refocuses the button.
    fireEvent.keyDown(focused(), { key: 'End' });
    fireEvent.keyDown(focused(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(await storedLevel(id)).toBeUndefined();

    // Enter chooses.
    fireEvent.keyDown(button, { key: 'ArrowUp' });
    await waitFor(() => {
      expect(focused().textContent).toBe('Default');
    });
    fireEvent.keyDown(focused(), { key: 'ArrowDown' });
    fireEvent.keyDown(focused(), { key: 'ArrowDown' });
    fireEvent.keyDown(focused(), { key: 'Enter' });
    await waitFor(() => {
      expect(controlText()).toBe('Medium');
    });
    expect(document.activeElement).toBe(button);
    expect(await storedLevel(id)).toBe('medium');

    // Space chooses too; the list opens on the current level.
    fireEvent.click(button);
    await waitFor(() => {
      expect(focused().textContent).toBe('Medium');
    });
    fireEvent.keyDown(focused(), { key: 'ArrowDown' });
    fireEvent.keyDown(focused(), { key: ' ' });
    await waitFor(() => {
      expect(controlText()).toBe('High');
    });

    // Tab closes without a change.
    fireEvent.click(button);
    await waitFor(() => {
      expect(focused().textContent).toBe('High');
    });
    fireEvent.keyDown(focused(), { key: 'ArrowUp' });
    fireEvent.keyDown(focused(), { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(await storedLevel(id)).toBe('high');
  });

  it('closes on a click outside and on a second click of the button', async () => {
    await open();
    fireEvent.click(control() as HTMLElement);
    expect(screen.queryByRole('listbox')).not.toBeNull();
    fireEvent.mouseDown(input());
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
    fireEvent.click(control() as HTMLElement);
    fireEvent.click(control() as HTMLElement);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('has its label, accessible name and options in German', async () => {
    const id = await open({ locale: 'de' });
    const button = control() as HTMLElement;
    expect(button.textContent).toBe('Standard');
    expect(button.getAttribute('aria-label')).toBe('Denkstufe: Standard');
    fireEvent.click(button);
    const list = screen.getByRole('listbox', { name: 'Denkstufe' });
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Standard', 'Niedrig', 'Mittel', 'Hoch']);
    fireEvent.click(within(list).getByRole('option', { name: 'Hoch' }));
    await waitFor(() => {
      expect(controlText()).toBe('Hoch');
    });
    expect(screen.getByRole('button', { name: 'Denkstufe: Hoch' })).toBe(control());
    expect(await storedLevel(id)).toBe('high');
  });

  it('shows a save error when the change can not be stored', async () => {
    await open();
    repo.updateSession = () => Promise.reject(new Error('quota'));
    fireEvent.click(control() as HTMLElement);
    fireEvent.click(within(listbox()).getByRole('option', { name: 'High' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      "The change couldn't be saved. Try again.",
    );
    expect(controlText()).toBe('Default');
  });
});

describe('when the control shows (spec 4.1, 4.2)', () => {
  it('is hidden while no provider is set up', async () => {
    await open({ providers: [] });
    expect(control()).toBeNull();
    expect(document.getElementById('model-button')).toBeNull();
    expect(document.querySelector('.model-menu, .thinking-menu')).toBeNull();
  });

  it.each([
    ['a model the list calls supported', 'thinks'],
    ['a model the list says nothing about', 'plain'],
    ['a model typed by hand', 'typed-by-hand'],
    ['a model id named like an inherited member', 'constructor'],
  ])('shows for %s', async (_case, model) => {
    await open({ model });
    expect(controlText()).toBe('Default');
  });

  it('shows for every model of a provider cached before the feature', async () => {
    await open({ providers: [provider({ modelInfo: undefined })], model: 'cannot' });
    expect(controlText()).toBe('Default');
  });

  it('is hidden for a model known not to support thinking, while the model menu stays', async () => {
    await open({ model: 'cannot' });
    expect(control()).toBeNull();
    expect(document.getElementById('model-button')?.textContent).toBe('cannot');
    expect(document.querySelectorAll('.composer-toolbar .model-menu')).toHaveLength(1);
    expect(document.querySelector('.thinking-menu')).toBeNull();
  });

  it('keeps the stored level while hidden and applies it again on a model that shows it', async () => {
    const id = await open({ model: 'thinks' });
    await choose('High');
    await chooseModel('cannot');
    await waitFor(() => {
      expect(control()).toBeNull();
    });
    expect(await repo.getSession(id)).toMatchObject({ model: 'cannot', thinkingLevel: 'high' });

    ask('Hidden?');
    await finished(1);
    expect(calls[0]?.body).toMatchObject({ model: 'cannot' });
    expect(calls[0]?.body).not.toHaveProperty('reasoning_effort');
    expect(await storedLevel(id)).toBe('high');

    await chooseModel('plain');
    await waitFor(() => {
      expect(controlText()).toBe('High');
    });
    ask('Shown again?');
    await finished(2);
    expect(calls[1]?.body).toMatchObject({ model: 'plain', reasoning_effort: 'high' });
  });

  it('shows, like the model menu, for a provider without host access', async () => {
    await open({ providers: [provider({ hasAccess: false, baseUrl: 'https://x.example/v1' })] });
    expect(document.getElementById('model-button')).not.toBeNull();
    expect(controlText()).toBe('Default');
  });
});

describe('while an answer streams', () => {
  // The model menu has no disabled state, so the control has none either
  // (spec 4.1 "follows the model menu's rules"; decisions.md T15).
  it('stays usable like the model menu, and a change applies to the next request only', async () => {
    const id = await open({ level: 'low' });
    const stream = controlledResponse();
    responders.push(() => stream.response);
    ask('First');
    await screen.findByRole('button', { name: 'Stop' });
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toMatchObject({ reasoning_effort: 'low' });
    for (const button of [control(), document.getElementById('model-button')]) {
      expect(button?.hasAttribute('disabled')).toBe(false);
      expect(button?.getAttribute('aria-disabled')).toBeNull();
    }

    await choose('High');
    expect(await storedLevel(id)).toBe('high');
    // The request on its way is not repeated or changed.
    expect(calls).toHaveLength(1);
    stream.push(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Done.' } }] })}\n\n`);
    stream.push('data: [DONE]\n\n');
    stream.close();
    await finished(1);
    expect(answers()[0]?.textContent).toContain('Done.');

    ask('Second');
    await finished(2);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({ reasoning_effort: 'high' });
  });
});

describe('what a request carries', () => {
  it.each([
    ['Low', 'low'],
    ['Medium', 'medium'],
    ['High', 'high'],
  ] as const)('Ask sends %s as reasoning_effort', async (name, level) => {
    await open();
    await choose(name);
    ask('What is new?');
    await finished(1);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0]?.body).toMatchObject({ model: 'plain', reasoning_effort: level });
  });

  it('Ask at Default sends no level', async () => {
    await open();
    ask('What is new?');
    await finished(1);
    expect(calls[0]?.body).not.toHaveProperty('reasoning_effort');
    expect(Object.keys(calls[0]?.body ?? {})).toEqual(['model', 'messages', 'stream']);
  });

  it('Summarize sends the level', async () => {
    await open({ level: 'medium' });
    const button = screen.getByRole('button', { name: 'Summarize' });
    await waitFor(() => {
      expect(button.getAttribute('aria-disabled')).toBe('false');
    });
    fireEvent.click(button);
    await finished(1);
    expect(JSON.stringify(calls[0]?.body)).toContain(PIN_TEXT);
    expect(calls[0]?.body).toMatchObject({ reasoning_effort: 'medium' });
  });

  it('the title request never carries the level', async () => {
    const id = await open({ level: 'high', untitled: true });
    responders.push(
      () => answer('/chat/completions', 'Trains are back.'),
      () => answer('/chat/completions', 'Night trains'),
    );
    ask('What is new?');
    await waitFor(() => {
      expect(titleButton().textContent).toBe('Night trains');
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toMatchObject({ reasoning_effort: 'high' });
    expect(isTitleRequest(calls[1] as Call)).toBe(true);
    expect(calls[1]?.body).not.toHaveProperty('reasoning_effort');
    expect(Object.keys(calls[1]?.body ?? {})).toEqual(['model', 'messages', 'stream']);
    expect((await repo.getSession(id))?.titleSource).toBe('llm');
  });

  it('Test connection never carries the level', async () => {
    await open({ level: 'high' });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Edit/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('The connection works.')).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).not.toHaveProperty('reasoning_effort');
    expect(Object.keys(calls[0]?.body ?? {})).toEqual([
      'model',
      'messages',
      'stream',
      'max_completion_tokens',
    ]);
  });

  it('a hidden control sends no level, whatever the session has stored', async () => {
    const id = await open({ model: 'cannot', level: 'high' });
    expect(control()).toBeNull();
    ask('What is new?');
    await finished(1);
    expect(calls[0]?.body).toMatchObject({ model: 'cannot' });
    expect(calls[0]?.body).not.toHaveProperty('reasoning_effort');
    expect(await storedLevel(id)).toBe('high');
  });

  describe('the model info reaches the request', () => {
    const effort: ModelInfo = {
      thinking: 'supported',
      thinkingMode: 'effort',
      maxOutputTokens: 64000,
    };
    const budget: ModelInfo = {
      thinking: 'supported',
      thinkingMode: 'budget',
      maxOutputTokens: 8192,
    };
    const anthropic = (modelInfo: Record<string, ModelInfo> | undefined) =>
      provider({
        kind: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-x',
        cachedModels: ['claude-x'],
        modelInfo,
      });
    const gemini = (modelInfo: Record<string, ModelInfo> | undefined, model: string) =>
      provider({
        kind: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        defaultModel: model,
        cachedModels: [model],
        modelInfo,
      });

    it('Anthropic effort mode: reasoning is asked for at Default, the level adds the effort', async () => {
      await open({ providers: [anthropic({ 'claude-x': effort })], untitled: true });
      ask('At Default');
      await finished(1);
      expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
      expect(calls[0]?.body).toMatchObject({
        model: 'claude-x',
        max_tokens: 32000,
        thinking: { type: 'adaptive', display: 'summarized' },
      });
      expect(calls[0]?.body).not.toHaveProperty('output_config');

      // The title request: today's body, without thinking.
      await waitFor(() => {
        expect(calls).toHaveLength(2);
      });
      expect(isTitleRequest(calls[1] as Call)).toBe(true);
      expect(calls[1]?.body).not.toHaveProperty('thinking');
      expect(calls[1]?.body).not.toHaveProperty('output_config');
      expect(calls[1]?.body).toMatchObject({ max_tokens: 4096 });

      await choose('High');
      ask('At High');
      await finished(2);
      expect(calls[2]?.body).toMatchObject({
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: 'high' },
      });
    });

    it('Anthropic budget mode: the output cap from the model list bounds the request', async () => {
      await open({ providers: [anthropic({ 'claude-x': budget })], level: 'medium' });
      ask('Budget');
      await finished(1);
      // 8192 would not stay below the cap of 8192, so it is lowered (spec 4.3).
      expect(calls[0]?.body).toMatchObject({
        max_tokens: 8192,
        thinking: { type: 'enabled', budget_tokens: 7168 },
      });
    });

    it('Anthropic unknown model: nothing at Default, effort mode with a level', async () => {
      await open({ providers: [anthropic(undefined)] });
      ask('At Default');
      await finished(1);
      expect(calls[0]?.body).not.toHaveProperty('thinking');
      expect(calls[0]?.body).toMatchObject({ max_tokens: 4096 });
      await choose('Low');
      ask('At Low');
      await finished(2);
      expect(calls[1]?.body).toMatchObject({
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: 'low' },
      });
    });

    it('Gemini: a supported model is asked for its thoughts at Default, an unknown one is not', async () => {
      await open({
        providers: [gemini({ 'gemini-3-pro': { thinking: 'supported' } }, 'gemini-3-pro')],
      });
      ask('Supported');
      await finished(1);
      expect(calls[0]?.url).toContain('gemini-3-pro:streamGenerateContent');
      expect(calls[0]?.body).toMatchObject({
        generationConfig: { thinkingConfig: { includeThoughts: true } },
      });
      await choose('High');
      ask('With a level');
      await finished(2);
      expect(calls[1]?.body).toMatchObject({
        generationConfig: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } },
      });
      cleanup();
      repo.close();

      calls = [];
      await open({ providers: [gemini(undefined, 'gemini-2.5-flash')] });
      ask('Unknown');
      await finished(1);
      expect(calls[0]?.body).not.toHaveProperty('generationConfig');
      await choose('Low');
      ask('Unknown with a level');
      await finished(2);
      expect(calls[1]?.body).toMatchObject({
        generationConfig: { thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 } },
      });
    });
  });
});

describe('a rejected thinking level (spec 4.6)', () => {
  const rejection = () =>
    jsonResponse(400, {
      error: { message: PROVIDER_TEXT, type: 'invalid_request_error', param: 'reasoning_effort' },
    });

  it('shows its own message with Retry; after Default, Retry succeeds', async () => {
    const id = await open({ level: 'high' });
    responders.push(rejection, rejection);
    ask('Why night trains?');
    const alert = await screen.findByRole('alert');
    expect(alert.querySelectorAll('p')).toHaveLength(1);
    expect(alert.querySelector('p')?.textContent).toBe(REJECTED);
    // The provider's own text is not shown.
    expect(alert.textContent).not.toContain('reasoning_effort');
    expect(alert.textContent).not.toContain('Provider message');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ reasoning_effort: 'high' });
    expect((await repo.listMessages(id)).map((m) => [m.role, m.error ?? null])).toEqual([
      ['user', null],
      ['assistant', 'thinking-unsupported'],
    ]);
    // No automatic retry without the level (owner decision O2), and the level stays.
    await pause(50);
    expect(calls).toHaveLength(1);
    expect(await storedLevel(id)).toBe('high');

    // Retry at the same level is rejected again.
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]?.body).toMatchObject({ reasoning_effort: 'high' });
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(REJECTED);
    });

    // Back to Default, then Retry: the same question goes out without a level.
    await choose('Default');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    await finished(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(answers()[0]?.textContent).toContain('Fine.');
    expect(calls[2]?.body).not.toHaveProperty('reasoning_effort');
    expect(JSON.stringify(calls[2]?.body)).toContain('Why night trains?');
    expect((await repo.listMessages(id)).map((m) => [m.role, m.text, m.error ?? null])).toEqual([
      ['user', 'Why night trains?', null],
      ['assistant', 'Fine.', null],
    ]);
  });

  it('keeps the message after the sidebar is reopened, and shows it in German', async () => {
    await open({ level: 'low' });
    responders.push(rejection);
    ask('Why?');
    expect((await screen.findByRole('alert')).textContent).toContain(REJECTED);
    cleanup();
    await show();
    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe(REJECTED);
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
    cleanup();
    repo.close();

    await open({ level: 'low', locale: 'de' });
    responders.push(rejection);
    fireEvent.input(screen.getByRole('textbox', { name: 'Frag etwas zu diesen Seiten…' }), {
      target: { value: 'Warum?' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Frag etwas zu diesen Seiten…' }), {
      key: 'Enter',
    });
    expect((await screen.findByRole('alert')).querySelector('p')?.textContent).toBe(
      'Dieses Modell unterstützt keine Denkstufe. Stell das Denken auf Standard und versuch es erneut.',
    );
  });

  it('the same 400 at Default is an ordinary rejected request, with the provider text', async () => {
    await open();
    responders.push(rejection);
    ask('Why?');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The provider rejected the request.');
    expect(alert.textContent).toContain(`Provider message: ${PROVIDER_TEXT}`);
    expect(alert.textContent).not.toContain(REJECTED);
  });
});
