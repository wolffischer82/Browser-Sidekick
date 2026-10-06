import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { Composer, type ComposerState } from '@/entrypoints/sidepanel/components/Composer';
import { ModelMenu } from '@/entrypoints/sidepanel/components/ModelMenu';
import { Transcript } from '@/entrypoints/sidepanel/components/Transcript';
import type { SummarizeState } from '@/shared/chat/summarize';
import type { Message } from '@/shared/model';
import { useLocale } from './helpers/i18n';
import { STYLE_PATH } from './helpers/style';

// The composer card (redesign spec 5.4), and the transcript's citations and
// empty state (5.3), rendered on their own.

const HINT = 'Enter to send · Shift+Enter for a new line';
const NO_PROVIDER = 'Add a provider in settings to ask questions.';

beforeEach(() => {
  fakeBrowser.reset();
  useLocale('en');
});

afterEach(() => {
  cleanup();
});

interface Options {
  state?: ComposerState;
  busy?: boolean;
  summarize?: SummarizeState;
}

function renderComposer({ state = { kind: 'ready' }, busy = false, summarize }: Options = {}) {
  const onSend = vi.fn<(question: string) => void>();
  const onSummarize = vi.fn<() => void>();
  const onNewSession = vi.fn<() => void>();
  const result = render(
    <Composer
      state={state}
      busy={busy}
      onSend={onSend}
      onOpenSettings={() => undefined}
      onGrantAccess={() => undefined}
      summarize={summarize ?? { kind: 'ready' }}
      onSummarize={onSummarize}
      onNewSession={onNewSession}
    />,
  );
  return { onSend, onSummarize, onNewSession, rerender: result.rerender };
}

const input = () =>
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Ask about these pages…' });
const send = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Send' });

function type(text: string): void {
  fireEvent.input(input(), { target: { value: text } });
}

/** What Enter does: whether it sent, compared with what Send offers. */
function pressEnter(): void {
  fireEvent.keyDown(input(), { key: 'Enter' });
}

describe('Send (redesign spec 5.4)', () => {
  it('is a labelled icon button in the toolbar, after Summarize', () => {
    renderComposer();
    const button = send();
    expect(button.getAttribute('title')).toBe('Send');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    const toolbar = button.closest('.composer-toolbar');
    expect(toolbar?.closest('.composer-card')?.contains(input())).toBe(true);
    expect([...(toolbar?.querySelectorAll('button') ?? [])].map((b) => b.id)).toEqual([
      'new-session-button',
      'summarize-button',
      'send-button',
    ]);
  });

  it('is disabled with an empty or blank input, like Enter', () => {
    const { onSend } = renderComposer();
    expect(send().disabled).toBe(true);
    pressEnter();
    type('   \n ');
    expect(send().disabled).toBe(true);
    pressEnter();
    fireEvent.click(send());
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends what Enter sends, clears the input and keeps focus there', () => {
    const { onSend } = renderComposer();
    type('Why night trains?');
    expect(send().disabled).toBe(false);
    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Why night trains?');
    expect(input().value).toBe('');
    expect(document.activeElement).toBe(input());
    expect(send().disabled).toBe(true);
    type('And the dashboard?');
    pressEnter();
    expect(onSend).toHaveBeenLastCalledWith('And the dashboard?');
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it('Shift+Enter neither sends nor disables Send', () => {
    const { onSend } = renderComposer();
    type('Line one');
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(send().disabled).toBe(false);
  });

  it('is disabled while an answer streams, and Enter does not send either', () => {
    const { onSend, rerender } = renderComposer({ busy: true });
    type('Next question');
    expect(send().disabled).toBe(true);
    pressEnter();
    fireEvent.click(send());
    expect(onSend).not.toHaveBeenCalled();
    rerender(
      <Composer
        state={{ kind: 'ready' }}
        busy={false}
        onSend={onSend}
        onOpenSettings={() => undefined}
        onGrantAccess={() => undefined}
        summarize={{ kind: 'ready' }}
        onSummarize={() => undefined}
        onNewSession={() => undefined}
      />,
    );
    expect(send().disabled).toBe(false);
    pressEnter();
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Next question');
  });

  it.each<[string, ComposerState]>([
    ['no provider', { kind: 'noProvider' }],
    ['no access', { kind: 'noAccess', providerLabel: 'Local' }],
  ])('is disabled with %s, as the input is', (_case, state) => {
    const { onSend } = renderComposer({ state });
    expect(input().disabled).toBe(true);
    expect(send().disabled).toBe(true);
    fireEvent.click(send());
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('hints under the card', () => {
  it('shows the keyboard hint while asking works', () => {
    renderComposer();
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(document.querySelector('.composer-card')?.hasAttribute('data-unavailable')).toBe(false);
    expect(input().hasAttribute('aria-describedby')).toBe(false);
  });

  it('replaces it with the no-provider hint and its link, the card faded', () => {
    renderComposer({ state: { kind: 'noProvider' } });
    expect(screen.queryByText(HINT)).toBeNull();
    const hint = document.getElementById('composer-hint');
    expect(hint?.textContent).toBe(`${NO_PROVIDER} Open settings`);
    expect(input().getAttribute('aria-describedby')).toBe('composer-hint');
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeTruthy();
    const card = document.querySelector('.composer-card');
    expect(card?.hasAttribute('data-unavailable')).toBe(true);
    // The link is outside the faded card.
    expect(card?.contains(hint)).toBe(false);
  });

  it('replaces it with the no-access hint and Grant access', () => {
    renderComposer({ state: { kind: 'noAccess', providerLabel: 'Local' } });
    expect(screen.queryByText(HINT)).toBeNull();
    expect(document.getElementById('composer-hint')?.textContent).toBe(
      'No access to Local. Grant access to ask questions. Grant access',
    );
    expect(document.querySelector('.composer-card')?.hasAttribute('data-unavailable')).toBe(true);
  });

  it('reads in German', () => {
    useLocale('de');
    renderComposer();
    expect(screen.getByText('Enter zum Senden · Umschalt+Enter für eine neue Zeile')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Senden' })).toBeTruthy();
  });
});

const newSession = () => screen.getByRole<HTMLButtonElement>('button', { name: 'New session' });

describe('New session in the toolbar (redesign spec O4)', () => {
  it('is a labelled plus icon button after the spacer, before Summarize', () => {
    renderComposer();
    const button = newSession();
    expect(button.getAttribute('title')).toBe('New session');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.previousElementSibling?.classList.contains('composer-spacer')).toBe(true);
    expect(button.nextElementSibling?.querySelector('#summarize-button')).not.toBeNull();
  });

  it('calls its handler on click', () => {
    const { onNewSession } = renderComposer();
    fireEvent.click(newSession());
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it.each<ComposerState>([{ kind: 'noProvider' }, { kind: 'noAccess', providerLabel: 'Local' }])(
    'stays enabled when asking is unavailable ($kind)',
    (state) => {
      const { onNewSession } = renderComposer({ state, summarize: { kind: 'noProvider' } });
      const button = newSession();
      expect(button.disabled).toBe(false);
      expect(button.hasAttribute('aria-disabled')).toBe(false);
      fireEvent.click(button);
      expect(onNewSession).toHaveBeenCalledTimes(1);
    },
  );

  it('is not faded with the card', () => {
    const css = readFileSync(STYLE_PATH, 'utf8');
    // No opacity on the card itself, which would fade every child.
    const card = /\.composer-card\[data-unavailable\] \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(card).not.toContain('opacity');
    expect(css).toMatch(
      /\.composer-card\[data-unavailable\] \.composer-toolbar > :not\(\.new-session-button\) \{\s*opacity: 0\.7;/,
    );
  });

  it('reads in German', () => {
    useLocale('de');
    renderComposer();
    expect(screen.getByRole('button', { name: 'Neue Sitzung' })).toBeTruthy();
  });
});

describe('Summarize in the toolbar', () => {
  it('keeps its name with an icon, and its unavailable tooltip', () => {
    const { onSummarize } = renderComposer({ summarize: { kind: 'nothing' } });
    const button = screen.getByRole('button', { name: 'Summarize' });
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.querySelector('.summarize-label')?.textContent).toBe('Summarize');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const tooltip = screen.getByRole('tooltip');
    expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(tooltip.textContent).toBe('Pin a page or open a readable tab to summarize.');
    fireEvent.click(button);
    expect(onSummarize).not.toHaveBeenCalled();
  });

  it('shows its icon only below 360 px; the label stays its accessible name', () => {
    const css = readFileSync(STYLE_PATH, 'utf8');
    const narrow = /@media \(max-width: 359px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const label = /\.summarize-label \{([^}]*)\}/.exec(narrow)?.[1] ?? '';
    // Visually hidden, not `display: none`, so the name stays.
    expect(label).toContain('position: absolute');
    expect(label).toContain('clip-path: inset(50%)');
    expect(label).not.toContain('display: none');
    renderComposer();
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeTruthy();
  });
});

describe('model menu button (redesign spec 5.4)', () => {
  const groups = [{ providerId: 'p1', label: 'Local', models: ['gpt-a', 'gpt-b'] }];

  it('shows a dot and the model name, with its name and tooltip', () => {
    render(
      <ModelMenu
        groups={groups}
        providerId="p1"
        model="gpt-a"
        providerLabel="Local"
        onChoose={() => undefined}
      />,
    );
    const button = screen.getByRole('button', { name: 'Model: Local · gpt-a' });
    expect(button.getAttribute('title')).toBe('Model: Local · gpt-a');
    expect(button.textContent).toBe('gpt-a');
    expect(button.querySelector('.model-dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.hasAttribute('data-empty')).toBe(false);
  });

  it('reads "No model" without a dot when the session has none', () => {
    render(
      <ModelMenu
        groups={groups}
        providerId={null}
        model={null}
        providerLabel={null}
        onChoose={() => undefined}
      />,
    );
    const button = screen.getByRole('button', { name: 'Model: No model' });
    expect(button.textContent).toBe('No model');
    expect(button.querySelector('.model-dot')).toBeNull();
    expect(button.hasAttribute('data-empty')).toBe(true);
  });
});

function answer(text: string): Message {
  return {
    id: 'a1',
    sessionId: 's1',
    position: 1,
    role: 'assistant',
    kind: 'ask',
    text,
    createdAt: 1,
    providerLabel: 'Local',
    model: 'gpt-a',
    sources: [
      { index: 1, title: 'Night trains return', url: 'https://news.example/', origin: 'pin' },
      { index: 2, title: 'Dashboard', url: 'https://dash.example/', origin: 'currentTab' },
    ],
    stopped: false,
    trimmed: false,
    error: null,
  };
}

function renderTranscript(messages: Message[], onOpenSource = vi.fn<(url: string) => void>()) {
  render(
    <Transcript
      messages={messages}
      live={null}
      errorOf={() => undefined}
      onStop={() => undefined}
      onRetry={() => undefined}
      onOpenSource={onOpenSource}
    />,
  );
  return onOpenSource;
}

describe('transcript (redesign spec 5.3)', () => {
  it('shows citations as numbers, with their names, opening their page', () => {
    const open = renderTranscript([answer('Trains are back [1]. Tickets: 12 [2].')]);
    const one = screen.getByRole('button', { name: 'Source 1: Night trains return' });
    const two = screen.getByRole('button', { name: 'Source 2: Dashboard' });
    expect(one.textContent).toBe('1');
    expect(two.textContent).toBe('2');
    expect(document.querySelector('.answer-body')?.textContent).not.toMatch(/\[\d\]/);
    fireEvent.click(two);
    expect(open).toHaveBeenCalledExactlyOnceWith('https://dash.example/');
    expect(screen.getByText('Local · gpt-a')).toBeTruthy();
  });

  it('sets citation chips flush with the punctuation after them', () => {
    const css = readFileSync(STYLE_PATH, 'utf8');
    const rule = /\.answer-body button\.citation \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/\bmargin: 0;/);
  });

  it('shows the decorative illustration above the empty text', () => {
    renderTranscript([]);
    const empty = document.querySelector('.transcript-empty');
    const art = empty?.querySelector('.empty-pages');
    expect(art?.getAttribute('aria-hidden')).toBe('true');
    expect(empty?.firstElementChild).toBe(art);
    expect(empty?.textContent).toBe(
      'Pin pages to this session, then ask about them or summarize them.',
    );
  });
});
