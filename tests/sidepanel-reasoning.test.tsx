import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { App } from '@/entrypoints/sidepanel/App';
import type { NewMessage, Repository } from '@/shared/db/repository';
import { DEFAULT_CONTEXT_BUDGET, type MessageSource, type ProviderConfig } from '@/shared/model';
import { updateSettings } from '@/shared/settings';
import type { Locale } from './helpers/i18n';
import { controlledResponse } from './helpers/llm-fetch';
import { NATIVE_HOSTS, fakePermissions } from './helpers/permissions';
import { freshRepository, renderSidebar } from './helpers/sidebar';

// The reasoning block above an answer (specs/thinking-levels.md 4.5, T16):
// for a stored answer and for one that streams, with the real
// OpenAI-compatible adapter behind a stubbed `fetch`. Nothing reaches the
// network.

const KEY = 'sk-reasoning-test-KEY-2468';
const SOURCES: MessageSource[] = [
  { index: 1, title: 'Night trains return', url: 'https://news.example/trains', origin: 'pin' },
];

let repo: Repository;
let responders: (() => Response)[];

const PROVIDER: ProviderConfig = {
  id: 'p1',
  kind: 'openai-compatible',
  label: 'Local',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: KEY,
  defaultModel: 'gpt-a',
  contextBudget: DEFAULT_CONTEXT_BUDGET,
  cachedModels: ['gpt-a'],
  hasAccess: true,
};

const delta = (fields: Record<string, unknown>) =>
  `data: ${JSON.stringify({ choices: [{ delta: fields }] })}\n\n`;
const text = (content: string) => delta({ content });
const thought = (content: string) => delta({ reasoning_content: content });
const DONE = 'data: [DONE]\n\n';
const errorChunk = `data: ${JSON.stringify({ error: { message: 'Overloaded' } })}\n\n`;

function sseOf(...events: string[]): Response {
  return new Response(events.join('') + DONE, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** The browser fakes; `freshRepository` resets them, so this runs after it. */
function fakes(): void {
  fakePermissions([...NATIVE_HOSTS, '<all_urls>']);
  vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 1 } as never);
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([] as never);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const next = url.endsWith('/chat/completions') ? responders.shift() : undefined;
      return Promise.resolve(next ? next() : new Response('', { status: 404 }));
    }),
  );
}

const answerOf = (fields: Partial<NewMessage>): NewMessage => ({
  role: 'assistant',
  text: 'Trains are back [1].',
  providerLabel: 'Local',
  model: 'gpt-a',
  sources: SOURCES,
  ...fields,
});

/** A named session with the given stored messages; the sidebar is rendered unless `show` is off. */
async function open(
  stored: NewMessage[] = [],
  options: { locale?: Locale; show?: boolean } = {},
): Promise<string> {
  repo = await freshRepository(options.locale ?? 'en');
  fakes();
  const session = await repo.createSession({ providerId: 'p1', model: 'gpt-a' });
  // A named session asks for no title: every request is an Ask.
  await repo.setSessionTitle(session.id, 'Trains', 'user');
  for (const message of stored) await repo.addMessage(session.id, message);
  await updateSettings({
    providers: [PROVIDER],
    defaultProviderId: 'p1',
    activeSessionId: session.id,
  });
  if (options.show !== false) await renderSidebar(repo);
  return session.id;
}

const QUESTION: NewMessage = { role: 'user', text: 'What is new?' };

const answers = () => screen.queryAllByRole('article', { name: 'Answer' });
const answer = async (index = 0): Promise<HTMLElement> => {
  await waitFor(() => {
    expect(answers().length).toBeGreaterThan(index);
  });
  return answers()[index] as HTMLElement;
};
const toggleIn = (article: HTMLElement) =>
  within(article).getByRole<HTMLButtonElement>('button', { name: /^(Reasoning|Thinking…)$/ });
const toggles = () => document.querySelectorAll<HTMLButtonElement>('.reasoning-toggle');
/** The element the toggle controls. */
const bodyOf = (toggle: HTMLElement): HTMLElement => {
  const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
  if (!body) throw new Error('The toggle controls nothing.');
  return body;
};

function ask(question: string): void {
  const input = screen.getByRole('textbox', { name: 'Ask about these pages…' });
  fireEvent.input(input, { target: { value: question } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

beforeEach(() => {
  responders = [];
});

afterEach(() => {
  cleanup();
  repo.close();
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).pwned;
});

describe('a stored answer', () => {
  it.each([
    ['without the field', {}],
    ['with null', { reasoning: null }],
    ['with an empty text', { reasoning: '' }],
  ])('renders as before %s: no reasoning block', async (_name, fields) => {
    await open([QUESTION, answerOf(fields)]);
    const article = await answer();
    expect(toggles()).toHaveLength(0);
    expect(article.querySelector('.reasoning, .reasoning-body')).toBeNull();
    // Exactly the elements an answer had before: its text and its model line.
    expect([...article.children].map((el) => [el.tagName, el.className])).toEqual([
      ['DIV', 'answer-body'],
      ['P', 'answer-meta'],
    ]);
    expect(
      within(article)
        .getAllByRole('button')
        .map((b) => b.className),
    ).toEqual(['citation']);
  });

  it('shows a collapsed toggle row above the answer text', async () => {
    await open([QUESTION, answerOf({ reasoning: 'Compare the two pages first.' })]);
    const article = await answer();
    const toggle = toggleIn(article);
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.type).toBe('button');
    expect(toggle.textContent).toBe('Reasoning');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const body = bodyOf(toggle);
    expect(body.hidden).toBe(true);
    // Collapsed, the reasoning is not in the page at all.
    expect(body.textContent).toBe('');
    expect(document.body.textContent).not.toContain('Compare the two pages');
    // Above the answer text.
    expect([...article.children].map((el) => el.className)).toEqual([
      'reasoning',
      'answer-body',
      'answer-meta',
    ]);
    expect(article.querySelector('.answer-body:not(.reasoning-body)')?.textContent).toContain(
      'Trains are back',
    );
  });

  it('expands to the reasoning as Markdown without citations, and collapses again', async () => {
    await open([
      QUESTION,
      answerOf({ reasoning: 'Page [1] covers it.\n\n- check **dates**\n- then answer' }),
    ]);
    const article = await answer();
    const toggle = toggleIn(article);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Reasoning');
    const body = bodyOf(toggle);
    expect(body.hidden).toBe(false);
    expect(body.querySelectorAll('li')).toHaveLength(2);
    expect(body.querySelector('strong')?.textContent).toBe('dates');
    expect(body.textContent).toContain('Page [1] covers it.');
    // No citation linking in the reasoning; the answer keeps its own.
    expect(body.querySelector('button')).toBeNull();
    expect(article.querySelectorAll('button.citation')).toHaveLength(1);
    // The answer text is unchanged by the block.
    expect(article.querySelector('.answer-body:not(.reasoning-body)')?.textContent.trim()).toBe(
      'Trains are back [1].',
    );

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    expect(body.textContent).toBe('');
  });

  it('is a native button: focusable, enabled, in the tab order', async () => {
    await open([QUESTION, answerOf({ reasoning: 'Some thought.' })]);
    const toggle = toggleIn(await answer());
    expect(toggle.disabled).toBe(false);
    expect(toggle.tabIndex).toBe(0);
    expect(toggle.hasAttribute('role')).toBe(false);
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    // A native button turns Enter and Space into a click (checked in a real
    // browser by the e2e); the click toggles and the focus stays on the row.
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(toggle);
    expect(bodyOf(toggle).textContent).toContain('Some thought.');
  });

  it('each answer has its own block and open state', async () => {
    await open([
      QUESTION,
      answerOf({ reasoning: 'First thought.' }),
      { role: 'user', text: 'And then?' },
      answerOf({ text: 'Plain.', sources: [] }),
      { role: 'user', text: 'More?' },
      answerOf({ text: 'More.', sources: [], reasoning: 'Third thought.' }),
    ]);
    await answer(2);
    expect(toggles()).toHaveLength(2);
    const [first, third] = [...toggles()] as [HTMLButtonElement, HTMLButtonElement];
    expect(answers()[1]?.querySelector('.reasoning')).toBeNull();
    expect(first.getAttribute('aria-controls')).not.toBe(third.getAttribute('aria-controls'));
    fireEvent.click(third);
    expect(third.getAttribute('aria-expanded')).toBe('true');
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(bodyOf(third).textContent).toContain('Third thought.');
    expect(document.body.textContent).not.toContain('First thought.');
  });

  it('a stopped answer with reasoning and no text reads "Reasoning"', async () => {
    await open([QUESTION, answerOf({ text: '', stopped: true, reasoning: 'Half a thought' })]);
    const article = await answer();
    expect(toggleIn(article).textContent).toBe('Reasoning');
    expect([...article.children].map((el) => el.className)).toEqual([
      'reasoning',
      'answer-mark',
      'answer-meta',
    ]);
  });

  it('a failed answer with reasoning and no text reads "Reasoning", with Retry', async () => {
    await open([QUESTION, answerOf({ text: '', error: 'server', reasoning: 'Half a thought' })]);
    const article = await answer();
    const toggle = toggleIn(article);
    expect(toggle.textContent).toBe('Reasoning');
    expect(within(article).getByRole('alert')).toBeTruthy();
    expect(within(article).getByRole('button', { name: 'Retry' })).toBeTruthy();
    fireEvent.click(toggle);
    expect(bodyOf(toggle).textContent).toContain('Half a thought');
  });

  it('is collapsed again when the session is reopened, and expands again', async () => {
    await open([QUESTION, answerOf({ reasoning: 'Kept with the answer.' })]);
    fireEvent.click(toggleIn(await answer()));
    expect(document.body.textContent).toContain('Kept with the answer.');

    cleanup();
    await renderSidebar(repo);
    const toggle = toggleIn(await answer());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.textContent).not.toContain('Kept with the answer.');
    fireEvent.click(toggle);
    expect(bodyOf(toggle).textContent).toContain('Kept with the answer.');
  });

  it('is collapsed again after switching to another session and back', async () => {
    const id = await open([QUESTION, answerOf({ reasoning: 'Kept with the answer.' })], {
      show: false,
    });
    const other = await repo.createSession({ providerId: 'p1', model: 'gpt-a' });
    await repo.setSessionTitle(other.id, 'Other', 'user');
    await updateSettings({ activeSessionId: id });
    await renderSidebar(repo);
    fireEvent.click(toggleIn(await answer()));
    expect(document.body.textContent).toContain('Kept with the answer.');

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Other/ }));
    await waitFor(() => {
      expect(answers()).toHaveLength(0);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Trains/ }));
    const toggle = toggleIn(await answer());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.textContent).not.toContain('Kept with the answer.');
  });

  it('uses the German label', async () => {
    await open([QUESTION, answerOf({ reasoning: 'Ein Gedanke.' })], { locale: 'de', show: false });
    render(<App repository={Promise.resolve(repo)} />);
    const toggle = await screen.findByRole('button', { name: 'Gedankengang' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(bodyOf(toggle).textContent).toContain('Ein Gedanke.');
  });

  it('injected script and onerror in the reasoning do not run', async () => {
    await open([
      QUESTION,
      answerOf({
        reasoning: [
          'Thinking <script>globalThis.pwned = 1</script>',
          '<img src="x" onerror="globalThis.pwned = 2">',
          '<a href="javascript:globalThis.pwned=3">x</a>',
          '<button class="citation" data-citation="1" onclick="globalThis.pwned=4">[1]</button>',
          '![secret](https://evil.example/leak)',
        ].join('\n\n'),
      }),
    ]);
    const toggle = toggleIn(await answer());
    fireEvent.click(toggle);
    const body = bodyOf(toggle);
    expect(body.textContent).toContain('Thinking');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(body.querySelector('script, img, button, [onerror], [onclick], [style]')).toBeNull();
    for (const a of body.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/javascript/i);
    }
    expect(body.innerHTML).not.toContain('evil.example');
    expect((globalThis as Record<string, unknown>).pwned).toBeUndefined();
  });
});

describe('an answer that streams', () => {
  it('reads "Thinking…" until answer text arrives, then "Reasoning", collapsed all along', async () => {
    const id = await open();
    const stream = controlledResponse();
    responders.push(() => stream.response);
    ask('Why?');
    await screen.findByRole('button', { name: 'Stop' });
    // Waiting, and streaming without reasoning: no block.
    expect(toggles()).toHaveLength(0);

    stream.push(thought('Let me think. '));
    const toggle = await screen.findByRole('button', { name: 'Thinking…' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.textContent).not.toContain('Let me think.');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();

    stream.push(text('Hello'));
    await waitFor(() => {
      expect(toggles()[0]?.textContent).toBe('Reasoning');
    });
    expect(toggles()[0]?.getAttribute('aria-expanded')).toBe('false');
    // Reasoning after the first answer text doesn't bring "Thinking…" back.
    stream.push(thought('One more check.'));
    stream.push(text(' world.'));
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Hello world.');
    });
    expect(toggles()[0]?.textContent).toBe('Reasoning');
    expect(screen.queryByRole('button', { name: 'Thinking…' })).toBeNull();

    stream.push(DONE);
    stream.close();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });
    const stored = toggleIn(await answer());
    expect(stored.textContent).toBe('Reasoning');
    expect(stored.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.textContent).not.toMatch(/Let me think|One more check/);
    expect((await repo.listMessages(id))[1]?.reasoning).toBe('Let me think. One more check.');
  });

  it('updates live while open, and stays open when the answer is stored', async () => {
    await open();
    const stream = controlledResponse();
    responders.push(() => stream.response);
    ask('Why?');
    await screen.findByRole('button', { name: 'Stop' });
    stream.push(thought('First **step**. '));
    const toggle = await screen.findByRole('button', { name: 'Thinking…' });
    fireEvent.click(toggle);
    expect(toggles()[0]?.getAttribute('aria-expanded')).toBe('true');
    const body = () => bodyOf(toggles()[0] as HTMLElement);
    await waitFor(() => {
      expect(body().textContent).toContain('First step.');
    });
    expect(body().querySelector('strong')?.textContent).toBe('step');
    expect(toggles()[0]?.textContent).toBe('Thinking…');

    stream.push(thought('Second step.'));
    await waitFor(() => {
      expect(body().textContent).toContain('First step. Second step.');
    });

    stream.push(text('The answer.'));
    await waitFor(() => {
      expect(toggles()[0]?.textContent).toBe('Reasoning');
    });
    expect(toggles()[0]?.getAttribute('aria-expanded')).toBe('true');
    // The answer text sits below the block and doesn't contain the reasoning.
    const article = answers()[0] as HTMLElement;
    const answerText = article.querySelector('.answer-body:not(.reasoning-body)');
    expect(answerText?.textContent.trim()).toBe('The answer.');
    expect(
      (article.querySelector('.reasoning') as Element).compareDocumentPosition(
        answerText as Element,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    stream.push(DONE);
    stream.close();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });
    expect(toggles()).toHaveLength(1);
    expect(toggles()[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(body().textContent).toContain('First step. Second step.');
  });

  it('a stopped answer with only reasoning reads "Reasoning" once it has ended', async () => {
    await open();
    const stream = controlledResponse();
    responders.push(() => stream.response);
    ask('Why?');
    await screen.findByRole('button', { name: 'Stop' });
    stream.push(thought('Still thinking'));
    await screen.findByRole('button', { name: 'Thinking…' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Stopped');
    });
    expect(screen.queryByRole('button', { name: 'Thinking…' })).toBeNull();
    const toggle = toggleIn(await answer());
    expect(toggle.textContent).toBe('Reasoning');
    fireEvent.click(toggle);
    expect(bodyOf(toggle).textContent).toContain('Still thinking');
  });

  it('a failed answer with only reasoning reads "Reasoning"; a Retry shows the new reasoning', async () => {
    await open();
    responders.push(
      () => sseOf(thought('Old thought.'), errorChunk),
      () => sseOf(thought('New thought.'), text('Now it works.')),
    );
    ask('Why?');
    const alert = await screen.findByRole('alert');
    const failed = toggleIn(await answer());
    expect(failed.textContent).toBe('Reasoning');
    fireEvent.click(failed);
    expect(bodyOf(failed).textContent).toContain('Old thought.');

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(answers()[0]?.textContent).toContain('Now it works.');
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });
    expect(toggles()).toHaveLength(1);
    const body = bodyOf(toggles()[0] as HTMLElement);
    expect(body.textContent).toContain('New thought.');
    expect(document.body.textContent).not.toContain('Old thought.');
  });

  it('uses the German labels while streaming', async () => {
    await open([], { locale: 'de', show: false });
    render(<App repository={Promise.resolve(repo)} />);
    const stream = controlledResponse();
    responders.push(() => stream.response);
    const input = await screen.findByRole('textbox', { name: 'Frag etwas zu diesen Seiten…' });
    await waitFor(() => {
      expect((input as HTMLTextAreaElement).disabled).toBe(false);
    });
    fireEvent.input(input, { target: { value: 'Warum?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    stream.push(thought('Ich überlege. '));
    await screen.findByRole('button', { name: 'Denkt nach …' });
    stream.push(text('Darum.'));
    await screen.findByRole('button', { name: 'Gedankengang' });
    expect(screen.queryByRole('button', { name: 'Denkt nach …' })).toBeNull();
    stream.push(DONE);
    stream.close();
    await waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Gedankengang' })).toBeTruthy();
  });
});
