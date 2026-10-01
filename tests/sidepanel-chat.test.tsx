import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Repository } from '@/shared/db/repository';
import { isSidekickMessage, type SidekickMessage } from '@/shared/messages';
import { DEFAULT_CONTEXT_BUDGET, type MessageSource, type ProviderConfig } from '@/shared/model';
import { getSettings, updateSettings } from '@/shared/settings';
import { controlledResponse, jsonResponse } from './helpers/llm-fetch';
import { NATIVE_HOSTS, fakePermissions, type FakePermissions } from './helpers/permissions';
import { freshRepository, renderSidebar, titleButton } from './helpers/sidebar';

// The ask flow in the sidebar (spec 5.2 item 4, 5.6, D11, D13) with a
// mocked provider behind a stubbed `fetch`: streaming, Stop, errors with
// Retry (stored with their code), the current tab and the eye, trimming,
// citations, the LLM title, history restore, and the "no access" input.

const KEY = 'sk-chat-test-KEY-9876';
const PIN_TEXT = 'Sleeper trains now run from Vienna to Amsterdam.';
const TAB_TEXT = 'The dashboard shows twelve open tickets.';

interface FakeTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
  active: boolean;
}

const ARTICLE: FakeTab = {
  id: 11,
  windowId: 1,
  url: 'https://news.example/trains',
  title: 'Night trains return',
  active: false,
};
const DASHBOARD: FakeTab = {
  id: 12,
  windowId: 1,
  url: 'https://dash.example/',
  title: 'Dashboard',
  active: true,
};

interface Body {
  model: string;
  messages: { role: string; content: string }[];
}

let repo: Repository;
let perms: FakePermissions;
let tabs: FakeTab[];
let broadcasts: SidekickMessage[];
let bodies: Body[];
let responders: (() => Response)[];
let script: MockInstance;
let tabsUpdate: MockInstance;
let windowsUpdate: MockInstance;
let tabsCreate: MockInstance;

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

function event(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function sse(...deltas: string[]): Response {
  return new Response(deltas.map(event).join('') + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** Stubs the global fetch the adapters use; nothing reaches the network. */
function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      // Anything but the provider (e.g. the PDF probe of a page) finds nothing.
      if (!url.endsWith('/chat/completions'))
        return Promise.resolve(new Response('', { status: 404 }));
      bodies.push(JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Body);
      const next = responders.shift();
      return Promise.resolve(next ? next() : jsonResponse(500, { error: { message: 'none' } }));
    }),
  );
}

function fakeTabs(): void {
  vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 1 } as never);
  vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation((q) =>
    Promise.resolve(
      (q.active ? tabs.filter((t) => t.active && t.windowId === q.windowId) : tabs) as never,
    ),
  );
  tabsUpdate = vi.spyOn(fakeBrowser.tabs, 'update').mockResolvedValue({} as never);
  windowsUpdate = vi.spyOn(fakeBrowser.windows, 'update').mockResolvedValue({} as never);
  tabsCreate = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never);
  script = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([
    {
      frameId: 0,
      documentId: 'd',
      result: { title: 'Dashboard', text: TAB_TEXT, truncated: false, method: 'innerText' },
    },
  ] as never);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((message: unknown) => {
    if (isSidekickMessage(message)) broadcasts.push(message);
    return Promise.resolve(undefined);
  });
}

/** The browser fakes; `freshRepository` resets them, so this runs after it. */
function fakes(granted: string[] = [...NATIVE_HOSTS, '<all_urls>']): void {
  perms = fakePermissions(granted);
  fakeTabs();
  stubFetch();
}

/** A session with one ready pin, the provider stored, and the sidebar rendered. */
async function open(
  options: { providers?: ProviderConfig[]; pinText?: string; granted?: string[] } = {},
): Promise<string> {
  repo = await freshRepository();
  fakes(options.granted);
  const session = await repo.createSession({ providerId: 'p1', model: 'gpt-a' });
  const pin = await repo.addPin(session.id, {
    url: ARTICLE.url,
    title: ARTICLE.title,
    kind: 'page',
  });
  await repo.updatePin(pin.id, { status: 'ready', text: options.pinText ?? PIN_TEXT });
  await updateSettings({
    providers: options.providers ?? [provider()],
    defaultProviderId: 'p1',
    activeSessionId: session.id,
  });
  await renderSidebar(repo);
  return session.id;
}

const input = () =>
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Ask about these pages…' });

function ask(question: string): void {
  fireEvent.input(input(), { target: { value: question } });
  fireEvent.keyDown(input(), { key: 'Enter' });
}

const answers = () => screen.queryAllByRole('article', { name: 'Answer' });
const questions = () => screen.queryAllByRole('article', { name: 'Your question' });
const systemOf = (i: number) => bodies[i]?.messages.find((m) => m.role === 'system')?.content ?? '';
const pause = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  tabs = [ARTICLE, DASHBOARD];
  broadcasts = [];
  bodies = [];
  responders = [];
});

afterEach(() => {
  cleanup();
  repo.close();
  vi.unstubAllGlobals();
});

describe('asking', () => {
  it('streams the answer, stores it with its sources and model, then titles the session', async () => {
    const id = await open();
    const stream = controlledResponse();
    responders.push(
      () => stream.response,
      () => sse('"Night trains', ' in Europe."'),
    );
    ask('What is new?');
    await waitFor(() => {
      expect(questions().map((q) => q.textContent)).toEqual(['What is new?']);
    });
    expect(input().value).toBe('');
    await screen.findByRole('button', { name: 'Stop' });
    stream.push(event('Trains are back [1]. '));
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Trains are back');
    });
    stream.push(event('Tickets: **12** [2].'));
    stream.push('data: [DONE]\n\n');
    stream.close();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });
    const answer = answers()[0] as HTMLElement;
    expect(answers()).toHaveLength(1);
    expect(answer.querySelector('strong')?.textContent).toBe('12');
    expect(
      within(answer).getByRole('button', { name: 'Source 1: Night trains return' }),
    ).toBeTruthy();
    expect(within(answer).getByRole('button', { name: 'Source 2: Dashboard' })).toBeTruthy();
    expect(answer.textContent).toContain('Local · gpt-a');

    // The request: the session's model, the pin then the current tab, the question.
    expect(bodies[0]?.model).toBe('gpt-a');
    const system = systemOf(0);
    expect(system).toContain(PIN_TEXT);
    expect(system).toContain(TAB_TEXT);
    expect(system.indexOf(PIN_TEXT)).toBeLessThan(system.indexOf(TAB_TEXT));
    expect(system).toContain('Source: current tab');
    expect(bodies[0]?.messages.at(-1)).toEqual({ role: 'user', content: 'What is new?' });
    expect(script).toHaveBeenCalledWith({ target: { tabId: 12 }, files: ['/extract-page.js'] });

    const stored = await repo.listMessages(id);
    expect(stored.map((m) => [m.role, m.text])).toEqual([
      ['user', 'What is new?'],
      ['assistant', 'Trains are back [1]. Tickets: **12** [2].'],
    ]);
    expect(stored[1]).toMatchObject({
      providerLabel: 'Local',
      model: 'gpt-a',
      stopped: false,
      error: null,
    });
    expect(stored[1]?.sources).toEqual<MessageSource[]>([
      { index: 1, title: ARTICLE.title, url: ARTICLE.url, origin: 'pin' },
      { index: 2, title: 'Dashboard', url: DASHBOARD.url, origin: 'currentTab' },
    ]);

    // D11: one title request after the first answer.
    await waitFor(() => {
      expect(titleButton().textContent).toBe('Night trains in Europe');
    });
    expect(bodies).toHaveLength(2);
    expect((await repo.getSession(id))?.titleSource).toBe('llm');
    expect(broadcasts).toContainEqual({ type: 'messages-changed', sessionId: id });
    expect(broadcasts).toContainEqual({ type: 'title-changed', sessionId: id });

    // A second answer carries the history and asks for no title.
    responders.push(() => sse('More.'));
    ask('And then?');
    await waitFor(() => {
      expect(answers()).toHaveLength(2);
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });
    await pause();
    expect(bodies).toHaveLength(3);
    expect(bodies[2]?.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('does not overwrite a manual rename with the LLM title', async () => {
    const id = await open();
    await repo.setSessionTitle(id, 'My name', 'user');
    responders.push(() => sse('Answer.'));
    ask('Q');
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Answer.');
    });
    await pause();
    expect(bodies).toHaveLength(1);
    expect((await repo.getSession(id))?.title).toBe('My name');
  });

  it('Shift+Enter does not send, and a busy session sends nothing more', async () => {
    await open();
    fireEvent.input(input(), { target: { value: 'Line' } });
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(questions()).toHaveLength(0);
    const stream = controlledResponse();
    responders.push(() => stream.response);
    ask('First');
    await screen.findByRole('button', { name: 'Stop' });
    ask('Second');
    await pause();
    expect(questions()).toHaveLength(1);
    expect(input().value).toBe('Second');
    expect(bodies).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });
  });

  it('Stop keeps the partial answer, marked stopped, and asks for no title', async () => {
    const id = await open();
    const stream = controlledResponse();
    responders.push(() => stream.response);
    ask('Long question');
    await screen.findByRole('button', { name: 'Stop' });
    stream.push(event('Partial text'));
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Partial text');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Stopped');
    });
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(input());
    const stored = await repo.listMessages(id);
    expect(stored[1]).toMatchObject({
      role: 'assistant',
      text: 'Partial text',
      stopped: true,
      error: null,
    });
    await pause();
    expect(bodies).toHaveLength(1);
    expect((await repo.getSession(id))?.titleSource).toBe('fallback');
  });
});

describe('errors', () => {
  it('shows a mapped error with Retry, which resends the question and clears the error', async () => {
    const id = await open();
    responders.push(
      () => jsonResponse(429, { error: { message: 'Slow down', type: 'rate_limit' } }),
      () => sse('Now it works.'),
      () => sse('A title'),
    );
    ask('Are tickets cheaper?');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("The provider's rate limit or quota was reached.");
    expect(alert.textContent).not.toContain(KEY);
    const failed = await repo.listMessages(id);
    expect(failed.map((m) => [m.role, m.error ?? null])).toEqual([
      ['user', null],
      ['assistant', 'rate-limit'],
    ]);
    // No title for a failed answer.
    await pause();
    expect(bodies).toHaveLength(1);

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Now it works.');
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(bodies[1]?.messages.slice(1)).toEqual([
      { role: 'user', content: 'Are tickets cheaper?' },
    ]);
    expect(questions()).toHaveLength(1);
    expect(answers()).toHaveLength(1);
    const stored = await repo.listMessages(id);
    expect(stored.map((m) => [m.role, m.text, m.error ?? null])).toEqual([
      ['user', 'Are tickets cheaper?', null],
      ['assistant', 'Now it works.', null],
    ]);
    expect(stored[1]?.id).toBe(failed[1]?.id);
    // The retried answer is the first completed one: it gets the title.
    await waitFor(() => {
      expect(titleButton().textContent).toBe('A title');
    });
  });

  it('keeps the error and Retry after the sidebar is reopened', async () => {
    const id = await open();
    responders.push(() => jsonResponse(401, { error: { message: 'bad key' } }));
    ask('Q1');
    await screen.findByRole('alert');
    cleanup();
    await renderSidebar(repo);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The API key was rejected.');
    responders.push(() => sse('Fine.'));
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Fine.');
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect((await repo.listMessages(id)).map((m) => m.error ?? null)).toEqual([null, null]);
  });

  it('a failed Retry keeps the error with its new code', async () => {
    const id = await open();
    responders.push(
      () => jsonResponse(429, { error: { message: 'Slow down' } }),
      () => jsonResponse(500, { error: { message: 'Oops' } }),
    );
    ask('Q');
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('The provider had a problem');
    });
    const stored = await repo.listMessages(id);
    expect(stored.map((m) => m.error ?? null)).toEqual([null, 'server']);
  });

  it("shows the provider's own message for a bad request, in this sidebar only", async () => {
    await open();
    responders.push(() =>
      jsonResponse(400, { error: { message: 'Unsupported parameter: foo', type: 'invalid' } }),
    );
    ask('Q');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Provider message: Unsupported parameter: foo');
    cleanup();
    await renderSidebar(repo);
    const restored = await screen.findByRole('alert');
    expect(restored.textContent).not.toContain('Unsupported parameter');
    expect(within(restored).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('keeps a partial text with the error, and leaves the failed pair out of the next request', async () => {
    await open();
    const stream = controlledResponse();
    responders.push(() => stream.response);
    ask('Q1');
    await screen.findByRole('button', { name: 'Stop' });
    stream.push(event('Half an ans'));
    stream.push(`data: ${JSON.stringify({ error: { message: 'Overloaded' } })}\n\n`);
    stream.close();
    const alert = await screen.findByRole('alert');
    expect(answers()[0]?.textContent).toContain('Half an ans');

    // A new question: the old error stays, without Retry.
    responders.push(() => sse('Fine.'));
    ask('Q2');
    await waitFor(() => {
      expect(answers()).toHaveLength(2);
      expect(answers()[1]?.textContent).toContain('Fine.');
    });
    expect(alert.isConnected).toBe(true);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(bodies[1]?.messages.slice(1)).toEqual([{ role: 'user', content: 'Q2' }]);
  });
});

describe('the current tab', () => {
  it('is left out when the eye excludes it, and not read', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Exclude from questions' }));
    responders.push(() => sse('Answer.'));
    ask('Q');
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Answer.');
    });
    expect(systemOf(0)).toContain(PIN_TEXT);
    expect(systemOf(0)).not.toContain(TAB_TEXT);
    expect(systemOf(0)).not.toContain('Source: current tab');
    expect(script).not.toHaveBeenCalled();
  });

  it('is not sent twice when it is already pinned', async () => {
    tabs = [{ ...ARTICLE, active: true }];
    await open();
    await screen.findByRole('button', { name: 'Unpin “Night trains return”' });
    responders.push(() => sse('Answer.'));
    ask('Q');
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Answer.');
    });
    expect(systemOf(0)).not.toContain('<<<PAGE 2>>>');
    expect(script).not.toHaveBeenCalled();
  });

  it('is sent without, with a notice, when it can not be read at send time', async () => {
    await open();
    await screen.findByRole('button', { name: 'Exclude from questions' });
    script.mockRejectedValue(new Error('Cannot access contents of the page.'));
    const stream = controlledResponse();
    responders.push(() => stream.response);
    ask('Q');
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain(
        "The current tab couldn't be read, so it wasn't included.",
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });
  });
});

it('shows the trimming notice and stores it with the answer', async () => {
  const id = await open({
    providers: [provider({ contextBudget: 1000 })],
    pinText: 'x'.repeat(10_000),
  });
  responders.push(() => sse('Short.'));
  ask('Q');
  await waitFor(() => {
    expect(answers()[0]?.textContent).toContain(
      'Some history or page text was left out to fit the context budget.',
    );
  });
  expect(systemOf(0).length).toBeLessThanOrEqual(4000);
  await waitFor(async () => {
    expect((await repo.listMessages(id))[1]?.trimmed).toBe(true);
  });
  // Stored: the notice stays on the answer.
  expect(answers()[0]?.textContent).toContain('left out to fit the context budget');
});

describe('history and citations', () => {
  const STORED = 'See [1] and [2]. <img src="x" onerror="globalThis.pwned = 1">';

  async function seeded(): Promise<string> {
    repo = await freshRepository();
    fakes();
    const session = await repo.createSession({ providerId: 'p1', model: 'gpt-a', title: 'Old' });
    await repo.addMessage(session.id, { role: 'user', text: 'Earlier question' });
    await repo.addMessage(session.id, {
      role: 'assistant',
      text: STORED,
      providerLabel: 'Local',
      model: 'gpt-b',
      sources: [
        { index: 1, title: 'Unpinned page', url: ARTICLE.url, origin: 'pin' },
        { index: 2, title: 'Closed page', url: 'https://closed.example/', origin: 'pin' },
      ],
      stopped: true,
      trimmed: true,
    });
    await updateSettings({
      providers: [provider()],
      defaultProviderId: 'p1',
      activeSessionId: session.id,
    });
    await renderSidebar(repo);
    await waitFor(() => {
      expect(answers()).toHaveLength(1);
    });
    return session.id;
  }

  it('restores the stored history with its marks and sanitised answers', async () => {
    await seeded();
    const answer = answers()[0] as HTMLElement;
    expect(questions()[0]?.textContent).toBe('Earlier question');
    expect(answer.textContent).toContain('Stopped');
    expect(answer.textContent).toContain('left out to fit the context budget');
    expect(answer.textContent).toContain('Local · gpt-b');
    expect(answer.querySelector('img')).toBeNull();
    await pause();
    expect((globalThis as Record<string, unknown>).pwned).toBeUndefined();
  });

  it('restores the history after switching sessions', async () => {
    const id = await seeded();
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    await waitFor(() => {
      expect(answers()).toHaveLength(0);
    });
    expect(screen.getByText(/Pin pages to this session/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Old/ }));
    await waitFor(() => {
      expect(answers()).toHaveLength(1);
    });
    expect(questions()[0]?.textContent).toBe('Earlier question');
    expect((await getSettings()).activeSessionId).toBe(id);
  });

  it('citations focus the open tab or open the URL, without the page being pinned', async () => {
    await seeded();
    const first = await screen.findByRole('button', { name: 'Source 1: Unpinned page' });
    // A real button: keyboard-operable, and with no address of its own.
    expect(first.tagName).toBe('BUTTON');
    expect(first.hasAttribute('href')).toBe(false);
    fireEvent.click(first);
    await waitFor(() => {
      expect(tabsUpdate).toHaveBeenCalledWith(11, { active: true });
    });
    expect(windowsUpdate).toHaveBeenCalledWith(1, { focused: true });
    fireEvent.click(screen.getByRole('button', { name: 'Source 2: Closed page' }));
    await waitFor(() => {
      expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://closed.example/' });
    });
  });

  it('a citation lookalike in a stored answer is an ordinary link the extension does not handle', async () => {
    repo = await freshRepository();
    fakes();
    const session = await repo.createSession({ providerId: 'p1', model: 'gpt-a' });
    await repo.addMessage(session.id, { role: 'user', text: 'Q' });
    await repo.addMessage(session.id, {
      role: 'assistant',
      text: 'Fake <a class="citation" data-citation="1" aria-label="Source 1: Unpinned page" href="https://evil.example/">[1]</a> and [[1]](https://evil.example/2), real [1].',
      sources: [{ index: 1, title: 'Unpinned page', url: ARTICLE.url, origin: 'pin' }],
    });
    await updateSettings({
      providers: [provider()],
      defaultProviderId: 'p1',
      activeSessionId: session.id,
    });
    await renderSidebar(repo);
    const real = await screen.findAllByRole('button', { name: 'Source 1: Unpinned page' });
    expect(real).toHaveLength(1);
    const fakeLinks = within(answers()[0] as HTMLElement).getAllByRole('link');
    expect(fakeLinks).toHaveLength(2);
    for (const link of fakeLinks) {
      expect(link.className).toBe('external-link');
      expect(link.hasAttribute('data-citation')).toBe(false);
      expect(link.getAttribute('aria-label')).toBeNull();
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      fireEvent.click(link);
    }
    await pause();
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('a new answer carries the stored history', async () => {
    await seeded();
    responders.push(() => sse('New.'));
    ask('Next');
    await waitFor(() => {
      expect(answers()[1]?.textContent).toContain('New.');
    });
    expect(bodies[0]?.messages.slice(1)).toEqual([
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: STORED },
      { role: 'user', content: 'Next' },
    ]);
  });

  it('shows a message another sidebar stored', async () => {
    const id = await seeded();
    await repo.addMessage(id, { role: 'user', text: 'From the other sidebar' });
    const replies: unknown[] = await fakeBrowser.runtime.onMessage.trigger(
      { type: 'messages-changed', sessionId: id },
      {},
    );
    // Sidebars never answer broadcasts.
    expect(replies.every((r) => r === undefined)).toBe(true);
    await waitFor(() => {
      expect(questions().map((q) => q.textContent)).toEqual([
        'Earlier question',
        'From the other sidebar',
      ]);
    });
  });
});

describe('provider without access', () => {
  const noAccess = () => [provider({ hasAccess: false, baseUrl: 'http://localhost:11434/v1' })];

  it('disables the input with Grant access, which requests the host from the click', async () => {
    await open({ providers: noAccess(), granted: NATIVE_HOSTS });
    expect(input().disabled).toBe(true);
    expect(screen.getByText(/No access to Local\. Grant access to ask questions\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    expect(perms.requests).toEqual([['http://localhost:11434/*']]);
    await waitFor(() => {
      expect(input().disabled).toBe(false);
    });
    expect(bodies).toHaveLength(0);
  });

  it('stays disabled when access is declined', async () => {
    await open({ providers: noAccess(), granted: NATIVE_HOSTS });
    perms.answer = 'decline';
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    await pause();
    expect(input().disabled).toBe(true);
  });
});
