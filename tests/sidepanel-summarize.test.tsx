import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { App } from '@/entrypoints/sidepanel/App';
import { pinWait } from '@/shared/chat/summarize';
import type { Repository } from '@/shared/db/repository';
import {
  DEFAULT_CONTEXT_BUDGET,
  type MessageSource,
  type PinStatus,
  type ProviderConfig,
} from '@/shared/model';
import { updateSettings } from '@/shared/settings';
import { readMessages, type Locale } from './helpers/i18n';
import { controlledResponse, jsonResponse } from './helpers/llm-fetch';
import { NATIVE_HOSTS, fakePermissions } from './helpers/permissions';
import { freshRepository, renderSidebar, titleButton } from './helpers/sidebar';

// Summarize in the sidebar (spec 5.2 item 5, 5.6, D4) with a mocked provider
// behind a stubbed `fetch`: the button's states and tooltips, the pages each
// request carries, the "Summarize" message, streaming, Stop, Retry, the
// title, the German prompt, and the wait for a pin that is still being read.

const PIN_TEXT = 'Sleeper trains now run from Vienna to Amsterdam.';
const SECOND_TEXT = 'Critics say the tickets cost too much.';
const TAB_TEXT = 'The dashboard shows twelve open tickets.';
const PROMPT = readMessages('en').summarizePrompt?.message ?? '';

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
const BROWSER_PAGE: FakeTab = {
  id: 13,
  windowId: 1,
  url: 'chrome://settings/',
  title: 'Settings',
  active: true,
};

interface Body {
  model: string;
  messages: { role: string; content: string }[];
}

interface PinSeed {
  url: string;
  title: string;
  text: string;
  status: PinStatus;
}

const ARTICLE_PIN: PinSeed = {
  url: ARTICLE.url,
  title: ARTICLE.title,
  text: PIN_TEXT,
  status: 'ready',
};
const SECOND_PIN: PinSeed = {
  url: 'https://opinion.example/critics',
  title: 'The critics',
  text: SECOND_TEXT,
  status: 'ready',
};

let repo: Repository;
let tabs: FakeTab[];
let bodies: Body[];
let responders: (() => Response)[];
let script: MockInstance;
let pinIds: string[];

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    kind: 'openai-compatible',
    label: 'Local',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-summarize-test',
    defaultModel: 'gpt-a',
    contextBudget: DEFAULT_CONTEXT_BUDGET,
    cachedModels: ['gpt-a'],
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

/** The browser fakes; `freshRepository` resets them, so this runs after it. */
function fakes(granted: string[]): void {
  fakePermissions(granted);
  vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 1 } as never);
  vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation((q) =>
    Promise.resolve(
      (q.active ? tabs.filter((t) => t.active && t.windowId === q.windowId) : tabs) as never,
    ),
  );
  script = vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([
    {
      frameId: 0,
      documentId: 'd',
      result: { title: 'Dashboard', text: TAB_TEXT, truncated: false, method: 'innerText' },
    },
  ] as never);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined);
  // Nothing reaches the network.
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      if (!url.endsWith('/chat/completions'))
        return Promise.resolve(new Response('', { status: 404 }));
      bodies.push(JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Body);
      const next = responders.shift();
      return Promise.resolve(next ? next() : jsonResponse(500, { error: { message: 'none' } }));
    }),
  );
}

interface OpenOptions {
  pins?: PinSeed[];
  providers?: ProviderConfig[];
  locale?: Locale;
  /** Host permissions held; all sites by default. */
  granted?: string[];
}

/** A session with the given pins and the provider stored, and the sidebar rendered. */
async function open(options: OpenOptions = {}): Promise<string> {
  const locale = options.locale ?? 'en';
  repo = await freshRepository(locale);
  fakes(options.granted ?? [...NATIVE_HOSTS, '<all_urls>']);
  const providers = options.providers ?? [provider()];
  const usable = providers.length > 0;
  const session = await repo.createSession({
    providerId: usable ? 'p1' : null,
    model: usable ? 'gpt-a' : null,
  });
  pinIds = [];
  for (const seed of options.pins ?? [ARTICLE_PIN]) {
    const pin = await repo.addPin(session.id, { url: seed.url, title: seed.title, kind: 'page' });
    await repo.updatePin(pin.id, { status: seed.status, text: seed.text });
    pinIds.push(pin.id);
  }
  await updateSettings({
    providers,
    defaultProviderId: usable ? 'p1' : null,
    activeSessionId: session.id,
  });
  if (locale === 'en') await renderSidebar(repo);
  else {
    render(<App repository={Promise.resolve(repo)} />);
    await screen.findByRole('button', { name: readMessages(locale).summarize?.message });
  }
  return session.id;
}

const button = (name = 'Summarize') => screen.getByRole('button', { name });
const tooltip = () =>
  document.getElementById(button().getAttribute('aria-describedby') ?? '')?.textContent ?? null;
const answers = () => screen.queryAllByRole('article', { name: 'Answer' });
const questions = () => screen.queryAllByRole('article', { name: 'Your question' });
const systemOf = (i: number) => bodies[i]?.messages.find((m) => m.role === 'system')?.content ?? '';
const pause = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function enabled(): Promise<void> {
  await waitFor(() => {
    expect(button().getAttribute('aria-disabled')).toBe('false');
  });
}

async function disabledWith(text: string): Promise<void> {
  await waitFor(() => {
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(tooltip()).toBe(text);
  });
}

async function finished(count = 1): Promise<void> {
  await waitFor(() => {
    expect(answers()).toHaveLength(count);
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });
}

const NOTHING = 'Pin a page or open a readable tab to summarize.';
const savedWait = { ...pinWait };

beforeEach(() => {
  tabs = [ARTICLE, DASHBOARD];
  bodies = [];
  responders = [];
});

afterEach(() => {
  Object.assign(pinWait, savedWait);
  cleanup();
  repo.close();
  vi.unstubAllGlobals();
});

describe('the Summarize button', () => {
  it('is enabled, without a tooltip, with a pin and a readable current tab', async () => {
    await open();
    await enabled();
    expect(button().hasAttribute('aria-describedby')).toBe(false);
    expect(screen.queryByRole('tooltip')).toBeNull();
    // Never natively disabled: it stays focusable.
    expect((button() as HTMLButtonElement).disabled).toBe(false);
  });

  it('is disabled with a tooltip when nothing is pinned and no tab is readable', async () => {
    tabs = [];
    await open({ pins: [] });
    await disabledWith(NOTHING);
    expect(screen.getByRole('tooltip').textContent).toBe(NOTHING);
    fireEvent.click(button());
    await pause();
    expect(bodies).toHaveLength(0);
    expect(questions()).toHaveLength(0);
  });

  it('is disabled on a browser page with only a failed and an extracting pin', async () => {
    tabs = [BROWSER_PAGE];
    await open({
      pins: [
        { ...ARTICLE_PIN, status: 'failed' },
        { ...SECOND_PIN, status: 'extracting' },
      ],
    });
    await disabledWith(NOTHING);
  });

  it('follows the eye: an excluded current tab with nothing pinned leaves nothing', async () => {
    await open({ pins: [] });
    await enabled();
    fireEvent.click(screen.getByRole('button', { name: 'Exclude from questions' }));
    await disabledWith(NOTHING);
    fireEvent.click(screen.getByRole('button', { name: 'Include in questions' }));
    await enabled();
  });

  it('becomes available when a pin turns ready', async () => {
    tabs = [];
    const id = await open({ pins: [{ ...ARTICLE_PIN, status: 'extracting' }] });
    await disabledWith(NOTHING);
    await repo.updatePin(pinIds[0] ?? '', { status: 'ready' });
    const replies: unknown[] = await fakeBrowser.runtime.onMessage.trigger(
      { type: 'pins-changed', sessionId: id },
      {},
    );
    expect(replies.every((r) => r === undefined)).toBe(true);
    await enabled();
  });

  it('is disabled with its own tooltip while no provider is set up', async () => {
    await open({ providers: [] });
    await disabledWith('Add a provider in settings to summarize.');
    fireEvent.click(button());
    await pause();
    expect(bodies).toHaveLength(0);
  });

  it('is disabled while the session’s provider has no access', async () => {
    // Only the native hosts and the tabs' sites are granted, not the provider's.
    await open({
      providers: [provider({ hasAccess: false, baseUrl: 'http://localhost:11434/v1' })],
      granted: [...NATIVE_HOSTS, 'https://news.example/*', 'https://dash.example/*'],
    });
    await pause();
    await disabledWith('No access to Local. Grant access to summarize.');
  });

  it('is disabled while an answer streams, and sends nothing more', async () => {
    await open();
    await enabled();
    const stream = controlledResponse();
    responders.push(() => stream.response);
    fireEvent.click(button());
    await screen.findByRole('button', { name: 'Stop' });
    await disabledWith('Wait for the answer to finish, or stop it.');
    // Stop shows before the request leaves (the message is stored and the
    // pages are read first), so wait for the request itself.
    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    fireEvent.click(button());
    await pause();
    expect(bodies).toHaveLength(1);
    expect(questions()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await enabled();
  });

  it('is disabled while a typed question is answered', async () => {
    await open();
    const stream = controlledResponse();
    responders.push(() => stream.response);
    const input = screen.getByRole('textbox', { name: 'Ask about these pages…' });
    fireEvent.input(input, { target: { value: 'A question' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await disabledWith('Wait for the answer to finish, or stop it.');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await enabled();
  });

  it('shows the German button and tooltip', async () => {
    tabs = [];
    await open({ pins: [], locale: 'de' });
    const de = screen.getByRole('button', { name: 'Zusammenfassen' });
    await waitFor(() => {
      expect(de.getAttribute('aria-disabled')).toBe('true');
      expect(document.getElementById(de.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
        readMessages('de').summarizeUnavailable?.message,
      );
    });
  });
});

describe('the pages a summary covers (D4)', () => {
  async function summarize(): Promise<string> {
    await enabled();
    responders.push(
      () => sse('Summary.'),
      () => sse('A title'),
    );
    fireEvent.click(button());
    await finished();
    return systemOf(0);
  }

  it('pins and the current tab', async () => {
    await open({ pins: [ARTICLE_PIN, SECOND_PIN] });
    const system = await summarize();
    expect(system).toContain(PIN_TEXT);
    expect(system).toContain(SECOND_TEXT);
    expect(system).toContain(TAB_TEXT);
    expect(system.indexOf(PIN_TEXT)).toBeLessThan(system.indexOf(SECOND_TEXT));
    expect(system.indexOf(SECOND_TEXT)).toBeLessThan(system.indexOf(TAB_TEXT));
    expect(system).toContain('<<<PAGE 3>>>');
    expect(system).toContain('Source: current tab');
  });

  it('pins only', async () => {
    tabs = [ARTICLE];
    await open({ pins: [ARTICLE_PIN, SECOND_PIN] });
    const system = await summarize();
    expect(system).toContain(PIN_TEXT);
    expect(system).toContain(SECOND_TEXT);
    expect(system).not.toContain('Source: current tab');
    expect(system).not.toContain('<<<PAGE 3>>>');
    expect(script).not.toHaveBeenCalled();
  });

  it('the current tab only', async () => {
    await open({ pins: [] });
    const system = await summarize();
    expect(system).toContain(TAB_TEXT);
    expect(system).toContain('<<<PAGE 1>>>');
    expect(system).toContain('Source: current tab');
    expect(system).not.toContain('<<<PAGE 2>>>');
  });

  it('a current tab that is already pinned is covered once, as the pin', async () => {
    tabs = [{ ...ARTICLE, active: true }];
    await open();
    await screen.findByRole('button', { name: 'Unpin “Night trains return”' });
    const system = await summarize();
    expect(system).toContain(PIN_TEXT);
    expect(system).not.toContain('<<<PAGE 2>>>');
    expect(system).not.toContain('Source: current tab');
    expect(script).not.toHaveBeenCalled();
  });

  it('an excluded current tab is left out, and not read', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Exclude from questions' }));
    const system = await summarize();
    expect(system).toContain(PIN_TEXT);
    expect(system).not.toContain(TAB_TEXT);
    expect(system).not.toContain('Source: current tab');
    expect(script).not.toHaveBeenCalled();
  });

  it('failed pins are left out and keep their number', async () => {
    tabs = [ARTICLE];
    await open({ pins: [{ ...ARTICLE_PIN, status: 'failed' }, SECOND_PIN] });
    const system = await summarize();
    expect(system).not.toContain(PIN_TEXT);
    expect(system).toContain(SECOND_TEXT);
    expect(system).toContain('<<<PAGE 2>>>');
    expect(system).not.toContain('<<<PAGE 1>>>');
  });
});

describe('summarising', () => {
  it('shows "Summarize", streams the answer, stores both and titles the session', async () => {
    const id = await open();
    await enabled();
    const stream = controlledResponse();
    responders.push(
      () => stream.response,
      () => sse('"Night trains', ' and tickets."'),
    );
    fireEvent.click(button());
    await waitFor(() => {
      expect(questions().map((q) => q.textContent)).toEqual(['Summarize']);
    });
    await screen.findByRole('button', { name: 'Stop' });
    stream.push(event('**Night trains return** [1]: sleepers are back. '));
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('sleepers are back');
    });
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    stream.push(event('**Dashboard** [2]: twelve tickets.'));
    stream.push('data: [DONE]\n\n');
    stream.close();
    await finished();
    const answer = answers()[0] as HTMLElement;
    expect(answer.querySelector('strong')?.textContent).toBe('Night trains return');
    expect(screen.getByRole('button', { name: 'Source 1: Night trains return' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Source 2: Dashboard' })).toBeTruthy();
    expect(answer.textContent).toContain('Local · gpt-a');
    // The prompt itself is never shown.
    expect(document.body.textContent).not.toContain(PROMPT);

    // The request: the session's model, and the fixed prompt as the question.
    expect(bodies[0]?.model).toBe('gpt-a');
    expect(bodies[0]?.messages.at(-1)).toEqual({ role: 'user', content: PROMPT });
    expect(PROMPT).toMatch(/TL;DR/);
    expect(PROMPT).toMatch(/detailed summary/);
    expect(PROMPT).toMatch(/each page/);
    expect(PROMPT).toMatch(/overall summary/);
    expect(PROMPT).toMatch(/themes/);
    expect(PROMPT).toMatch(/disagree/);
    expect(PROMPT).toMatch(/English/);

    const stored = await repo.listMessages(id);
    expect(stored.map((m) => [m.role, m.kind])).toEqual([
      ['user', 'summarize'],
      ['assistant', 'summarize'],
    ]);
    expect(stored[1]).toMatchObject({
      text: '**Night trains return** [1]: sleepers are back. **Dashboard** [2]: twelve tickets.',
      providerLabel: 'Local',
      model: 'gpt-a',
      stopped: false,
      error: null,
    });
    expect(stored[1]?.sources).toEqual<MessageSource[]>([
      { index: 1, title: ARTICLE.title, url: ARTICLE.url, origin: 'pin' },
      { index: 2, title: 'Dashboard', url: DASHBOARD.url, origin: 'currentTab' },
    ]);

    // D11: the summary is the session's first answer, so it gets the title.
    await waitFor(() => {
      expect(titleButton().textContent).toBe('Night trains and tickets');
    });
    expect(bodies).toHaveLength(2);
    expect((await repo.getSession(id))?.titleSource).toBe('llm');

    // Shown as "Summarize" again after the sidebar is reopened.
    cleanup();
    await renderSidebar(repo);
    await waitFor(() => {
      expect(questions().map((q) => q.textContent)).toEqual(['Summarize']);
    });
  });

  it('a later question carries the summary as history, and asks for no second title', async () => {
    await open();
    await enabled();
    responders.push(
      () => sse('The summary.'),
      () => sse('A title'),
      () => sse('More.'),
    );
    fireEvent.click(button());
    await finished();
    await waitFor(() => {
      expect(titleButton().textContent).toBe('A title');
    });
    const input = screen.getByRole('textbox', { name: 'Ask about these pages…' });
    fireEvent.input(input, { target: { value: 'And the price?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await finished(2);
    await pause();
    expect(bodies).toHaveLength(3);
    expect(bodies[2]?.messages.slice(1)).toEqual([
      { role: 'user', content: PROMPT },
      { role: 'assistant', content: 'The summary.' },
      { role: 'user', content: 'And the price?' },
    ]);
    expect(questions().map((q) => q.textContent)).toEqual(['Summarize', 'And the price?']);
  });

  it('Stop keeps the partial summary, marked stopped', async () => {
    const id = await open();
    await enabled();
    const stream = controlledResponse();
    responders.push(() => stream.response);
    fireEvent.click(button());
    await screen.findByRole('button', { name: 'Stop' });
    stream.push(event('Half a summ'));
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Half a summ');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Stopped');
    });
    expect((await repo.listMessages(id))[1]).toMatchObject({
      kind: 'summarize',
      text: 'Half a summ',
      stopped: true,
    });
  });

  it('an error shows Retry, which sends the same request and keeps "Summarize"', async () => {
    const id = await open();
    await enabled();
    responders.push(
      () => jsonResponse(429, { error: { message: 'Slow down' } }),
      () => sse('Now a summary.'),
      () => sse('A title'),
    );
    fireEvent.click(button());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("The provider's rate limit or quota was reached.");
    const failed = await repo.listMessages(id);
    expect(failed.map((m) => [m.kind, m.error ?? null])).toEqual([
      ['summarize', null],
      ['summarize', 'rate-limit'],
    ]);
    // The error and Retry survive a reload (D18), still as "Summarize".
    cleanup();
    await renderSidebar(repo);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Now a summary.');
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(questions().map((q) => q.textContent)).toEqual(['Summarize']);
    expect(bodies[1]?.messages.slice(1)).toEqual([{ role: 'user', content: PROMPT }]);
    const stored = await repo.listMessages(id);
    expect(stored.map((m) => [m.kind, m.error ?? null])).toEqual([
      ['summarize', null],
      ['summarize', null],
    ]);
    expect(stored[1]?.id).toBe(failed[1]?.id);
  });

  it('shows the trimming notice when the pages exceed the budget', async () => {
    await open({
      providers: [provider({ contextBudget: 1000 })],
      pins: [{ ...ARTICLE_PIN, text: 'x'.repeat(10_000) }],
    });
    await enabled();
    responders.push(() => sse('Short.'));
    fireEvent.click(button());
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain(
        'Some history or page text was left out to fit the context budget.',
      );
    });
    expect(systemOf(0).length).toBeLessThanOrEqual(4000);
  });

  it('sends the German prompt with a German UI and shows "Zusammenfassen"', async () => {
    await open({ locale: 'de' });
    const de = screen.getByRole('button', { name: 'Zusammenfassen' });
    await waitFor(() => {
      expect(de.getAttribute('aria-disabled')).toBe('false');
    });
    responders.push(
      () => sse('Zusammenfassung.'),
      () => sse('Ein Titel'),
    );
    fireEvent.click(de);
    await waitFor(() => {
      expect(bodies.length).toBeGreaterThan(0);
    });
    const prompt = readMessages('de').summarizePrompt?.message ?? '';
    expect(prompt).toMatch(/Antworte auf Deutsch/);
    expect(prompt).toMatch(/TL;DR/);
    expect(prompt).toMatch(/ausführliche Zusammenfassung/);
    expect(prompt).toMatch(/jede Seite/);
    expect(prompt).toMatch(/Gesamtzusammenfassung/);
    expect(prompt).toMatch(/Themen/);
    expect(prompt).toMatch(/widersprechen/);
    expect(bodies[0]?.messages.at(-1)).toEqual({ role: 'user', content: prompt });
    await waitFor(() => {
      expect(document.querySelector('.chat-question')?.textContent).toBe('Zusammenfassen');
      expect(document.querySelector('.chat-answer')?.textContent).toContain('Zusammenfassung.');
    });
  });
});

describe('a pin that is still being read', () => {
  it('is waited for, visibly, and then included', async () => {
    await open({ pins: [ARTICLE_PIN, { ...SECOND_PIN, status: 'extracting' }] });
    await enabled();
    pinWait.pollMs = 20;
    responders.push(() => sse('Summary.'));
    fireEvent.click(button());
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain(
        'Waiting for pinned pages that are still being read…',
      );
    });
    expect(bodies).toHaveLength(0);
    await repo.updatePin(pinIds[1] ?? '', { status: 'ready' });
    await finished();
    expect(systemOf(0)).toContain(PIN_TEXT);
    expect(systemOf(0)).toContain(SECOND_TEXT);
    expect(answers()[0]?.textContent).not.toContain('still being read');
  });

  it('is left out with a notice when it is not ready in time', async () => {
    await open({ pins: [ARTICLE_PIN, { ...SECOND_PIN, status: 'extracting' }] });
    await enabled();
    pinWait.pollMs = 10;
    pinWait.timeoutMs = 50;
    const stream = controlledResponse();
    responders.push(() => stream.response);
    fireEvent.click(button());
    await waitFor(() => {
      expect(bodies).toHaveLength(1);
      expect(answers()[0]?.textContent).toContain(
        "A pinned page was still being read, so it wasn't included.",
      );
    });
    expect(systemOf(0)).toContain(PIN_TEXT);
    expect(systemOf(0)).not.toContain(SECOND_TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });
  });

  it('Stop ends the wait and sends nothing', async () => {
    const id = await open({ pins: [ARTICLE_PIN, { ...SECOND_PIN, status: 'extracting' }] });
    await enabled();
    pinWait.pollMs = 20;
    fireEvent.click(button());
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Waiting for pinned pages');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });
    await pause(60);
    expect(bodies).toHaveLength(0);
    expect((await repo.listMessages(id)).map((m) => [m.kind, m.stopped, m.text])).toEqual([
      ['summarize', false, PROMPT],
      ['summarize', true, ''],
    ]);
  });
});
