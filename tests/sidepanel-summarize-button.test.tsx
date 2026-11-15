import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { LiveAnswer } from '@/entrypoints/sidepanel/chat/useChat';
import { SummarizeButton } from '@/entrypoints/sidepanel/components/SummarizeButton';
import { Transcript } from '@/entrypoints/sidepanel/components/Transcript';
import type { SummarizeState } from '@/shared/chat/summarize';
import type { Message, SummaryLevel } from '@/shared/model';
import { useLocale } from './helpers/i18n';
import { STYLE_PATH } from './helpers/style';

// The Summarize split button and the transcript label of a summary
// (specs/summary-levels.md 4.2, O4-O6), rendered on their own.

beforeEach(() => {
  fakeBrowser.reset();
  useLocale('en');
});

afterEach(() => {
  cleanup();
});

interface Options {
  state?: SummarizeState;
  level?: SummaryLevel;
}

function renderButton({ state = { kind: 'ready' }, level = 'standard' }: Options = {}) {
  const onSummarize = vi.fn<() => void>();
  const onPickLevel = vi.fn<(level: SummaryLevel) => void>();
  const view = (o: Required<Options>) => (
    <div>
      <SummarizeButton
        state={o.state}
        level={o.level}
        onSummarize={onSummarize}
        onPickLevel={onPickLevel}
      />
      <button type="button" id="outside">
        Outside
      </button>
    </div>
  );
  const result = render(view({ state, level }));
  return {
    onSummarize,
    onPickLevel,
    rerender: (o: Required<Options>) => {
      result.rerender(view(o));
    },
  };
}

const main = () => document.getElementById('summarize-button') as HTMLButtonElement;
const arrow = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Summary level' });
const menu = () => screen.queryByRole('menu');
const items = () => screen.queryAllByRole('menuitemradio');
const checked = () => items().filter((i) => i.getAttribute('aria-checked') === 'true');
const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });

describe('Summarize split button: main part (O5)', () => {
  it('shows the label, the remembered level as a suffix, and names both', () => {
    renderButton({ level: 'short' });
    const button = screen.getByRole('button', { name: 'Summarize · Short' });
    expect(button).toBe(main());
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    const label = button.querySelector('.summarize-label');
    expect(label?.firstChild?.textContent).toBe('Summarize');
    expect(label?.querySelector('.summarize-level')?.textContent).toBe('Short');
  });

  it('follows a change of the remembered level', () => {
    const { rerender } = renderButton({ level: 'short' });
    rerender({ state: { kind: 'ready' }, level: 'detailed' });
    expect(main().getAttribute('aria-label')).toBe('Summarize · Detailed');
    expect(main().querySelector('.summarize-level')?.textContent).toBe('Detailed');
  });

  it('summarizes at the remembered level on click', () => {
    const { onSummarize, onPickLevel } = renderButton({ level: 'veryShort' });
    fireEvent.click(main());
    expect(onSummarize).toHaveBeenCalledTimes(1);
    expect(onPickLevel).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it('shows the suffix muted after a separator, and hides it with the label in a narrow panel', () => {
    const css = readFileSync(STYLE_PATH, 'utf8');
    expect(/\.summarize-level \{([^}]*)\}/.exec(css)?.[1]).toContain('color: var(--muted)');
    expect(/\.summarize-level::before \{([^}]*)\}/.exec(css)?.[1]).toContain("content: ' · '");
    const narrow = /@media \(max-width: 359px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(/\.summarize-label \{([^}]*)\}/.exec(narrow)?.[1]).toContain('clip-path: inset(50%)');
    renderButton({ level: 'short' });
    // The suffix sits inside the label, so it goes with it; the name stays.
    expect(main().querySelector('.summarize-label .summarize-level')).not.toBeNull();
    expect(main().getAttribute('aria-label')).toBe('Summarize · Short');
  });

  it('reads in German', () => {
    useLocale('de');
    renderButton({ level: 'short' });
    expect(screen.getByRole('button', { name: 'Zusammenfassen · Kurz' })).toBe(main());
    expect(main().querySelector('.summarize-level')?.textContent).toBe('Kurz');
    expect(screen.getByRole('button', { name: 'Zusammenfassungsstufe' })).toBe(
      document.getElementById('summary-level-button'),
    );
  });
});

describe('Summarize split button: menu (4.2)', () => {
  it('the arrow is a menu button after the main part, closed at first', () => {
    renderButton();
    expect(main().nextElementSibling).toBe(arrow());
    expect(arrow().getAttribute('aria-haspopup')).toBe('menu');
    expect(arrow().getAttribute('aria-expanded')).toBe('false');
    expect(arrow().getAttribute('aria-disabled')).toBe('false');
    expect(arrow().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(menu()).toBeNull();
  });

  it('opens a menu of the four levels in order, the remembered one checked and focused', () => {
    renderButton({ level: 'short' });
    fireEvent.click(arrow());
    expect(arrow().getAttribute('aria-expanded')).toBe('true');
    expect(menu()?.getAttribute('aria-label')).toBe('Summary level');
    expect(items().map((i) => i.textContent)).toEqual([
      'Very short',
      'Short',
      'Standard',
      'Detailed',
    ]);
    expect(checked().map((i) => i.textContent)).toEqual(['Short']);
    expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    expect(document.activeElement).toBe(checked()[0]);
  });

  it('lists the levels in German', () => {
    useLocale('de');
    renderButton({ level: 'detailed' });
    fireEvent.click(screen.getByRole('button', { name: 'Zusammenfassungsstufe' }));
    expect(items().map((i) => i.textContent)).toEqual([
      'Sehr kurz',
      'Kurz',
      'Standard',
      'Ausführlich',
    ]);
    expect(checked().map((i) => i.textContent)).toEqual(['Ausführlich']);
  });

  it('closes on a second click on the arrow and on a click outside', () => {
    renderButton();
    fireEvent.click(arrow());
    fireEvent.click(arrow());
    expect(menu()).toBeNull();
    expect(arrow().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(arrow());
    fireEvent.mouseDown(document.getElementById('outside') as HTMLElement);
    expect(menu()).toBeNull();
  });

  it('picking a level by click closes the menu, returns focus and calls back with it', () => {
    const { onPickLevel, onSummarize } = renderButton({ level: 'standard' });
    fireEvent.click(arrow());
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Detailed' }));
    expect(onPickLevel).toHaveBeenCalledExactlyOnceWith('detailed');
    expect(onSummarize).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(arrow());
  });

  it('picking the remembered level summarizes at it as well', () => {
    const { onPickLevel } = renderButton({ level: 'short' });
    fireEvent.click(arrow());
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Short' }));
    expect(onPickLevel).toHaveBeenCalledExactlyOnceWith('short');
  });
});

describe('Summarize split button: keyboard (4.2)', () => {
  it.each(['ArrowDown', 'ArrowUp'])('%s on the arrow opens the menu on the checked item', (k) => {
    renderButton({ level: 'detailed' });
    key(arrow(), k);
    expect(menu()).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('Detailed');
  });

  it('arrow keys move, Home and End jump, and the ends hold', () => {
    renderButton({ level: 'short' });
    key(arrow(), 'ArrowDown');
    const focused = () => document.activeElement?.textContent;
    key(document.activeElement as Element, 'ArrowDown');
    expect(focused()).toBe('Standard');
    key(document.activeElement as Element, 'ArrowUp');
    key(document.activeElement as Element, 'ArrowUp');
    expect(focused()).toBe('Very short');
    key(document.activeElement as Element, 'ArrowUp');
    expect(focused()).toBe('Very short');
    key(document.activeElement as Element, 'End');
    expect(focused()).toBe('Detailed');
    key(document.activeElement as Element, 'ArrowDown');
    expect(focused()).toBe('Detailed');
    key(document.activeElement as Element, 'Home');
    expect(focused()).toBe('Very short');
  });

  it.each(['Enter', ' '])('%j picks the focused level and returns focus to the arrow', (k) => {
    const { onPickLevel } = renderButton({ level: 'standard' });
    key(arrow(), 'ArrowDown');
    key(document.activeElement as Element, 'ArrowUp');
    key(document.activeElement as Element, k);
    expect(onPickLevel).toHaveBeenCalledExactlyOnceWith('short');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(arrow());
  });

  it('Escape closes and returns focus to the arrow, without picking', () => {
    const { onPickLevel } = renderButton();
    const outer = vi.fn();
    key(arrow(), 'ArrowDown');
    document.addEventListener('keydown', outer);
    key(document.activeElement as Element, 'Escape');
    document.removeEventListener('keydown', outer);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(arrow());
    expect(onPickLevel).not.toHaveBeenCalled();
    // Settings and the drawer don't see it.
    expect(outer).not.toHaveBeenCalled();
  });

  it('Tab closes the menu without picking', () => {
    const { onPickLevel } = renderButton();
    key(arrow(), 'ArrowDown');
    key(document.activeElement as Element, 'Tab');
    expect(menu()).toBeNull();
    expect(onPickLevel).not.toHaveBeenCalled();
  });
});

describe('Summarize split button: unavailable (O6)', () => {
  const cases: [SummarizeState, string][] = [
    [{ kind: 'nothing' }, 'Pin a page or open a readable tab to summarize.'],
    [{ kind: 'busy' }, 'Wait for the answer to finish, or stop it.'],
    [{ kind: 'noProvider' }, 'Add a provider in settings to summarize.'],
  ];

  it.each(cases)('both parts are aria-disabled with the tooltip ($kind)', (state, text) => {
    const { onSummarize, onPickLevel } = renderButton({ state });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe(text);
    for (const part of [main(), arrow()]) {
      expect(part.getAttribute('aria-disabled')).toBe('true');
      expect(part.disabled).toBe(false);
      expect(part.getAttribute('aria-describedby')).toBe(tooltip.id);
    }
    expect(arrow().hasAttribute('title')).toBe(false);
    fireEvent.click(main());
    fireEvent.click(arrow());
    key(arrow(), 'ArrowDown');
    key(arrow(), 'ArrowUp');
    expect(menu()).toBeNull();
    expect(arrow().getAttribute('aria-expanded')).toBe('false');
    expect(onSummarize).not.toHaveBeenCalled();
    expect(onPickLevel).not.toHaveBeenCalled();
  });

  it('names the provider without access', () => {
    renderButton({ state: { kind: 'noAccess', providerLabel: 'Local' } });
    expect(screen.getByRole('tooltip').textContent).toContain('Local');
  });

  it('no tooltip while available; the arrow has its own title then', () => {
    renderButton();
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(main().hasAttribute('aria-describedby')).toBe(false);
    expect(arrow().getAttribute('title')).toBe('Summary level');
  });

  it('an open menu closes when Summarize becomes unavailable, and stays closed', () => {
    const { rerender } = renderButton();
    fireEvent.click(arrow());
    expect(menu()).not.toBeNull();
    rerender({ state: { kind: 'busy' }, level: 'standard' });
    expect(menu()).toBeNull();
    rerender({ state: { kind: 'ready' }, level: 'standard' });
    expect(menu()).toBeNull();
    expect(arrow().getAttribute('aria-expanded')).toBe('false');
  });

  it('the tooltip shows on keyboard focus of either part', () => {
    const css = readFileSync(STYLE_PATH, 'utf8');
    expect(css).toContain('.tooltip-anchor > :focus-visible ~ .tooltip');
  });
});

function summary(id: string, position: number, summaryLevel?: SummaryLevel | null): Message {
  return {
    id,
    sessionId: 's1',
    position,
    role: 'user',
    kind: 'summarize',
    text: 'Summarize the pages provided.',
    createdAt: position,
    providerLabel: null,
    model: null,
    sources: [],
    stopped: false,
    trimmed: false,
    error: null,
    ...(summaryLevel === undefined ? {} : { summaryLevel }),
  };
}

function live(summaryLevel: SummaryLevel | null): LiveAnswer {
  return {
    sessionId: 's1',
    kind: 'summarize',
    question: 'Summarize the pages provided.',
    summaryLevel,
    questionId: null,
    replacesId: null,
    status: 'waiting',
    text: '',
    reasoning: '',
    sources: [],
    trimmed: false,
    tabSkipped: false,
    waitingForPins: false,
    pinsSkipped: false,
  };
}

function renderTranscript(messages: Message[], answer: LiveAnswer | null = null) {
  render(
    <Transcript
      messages={messages}
      live={answer}
      errorOf={() => undefined}
      onStop={() => undefined}
      onRetry={() => undefined}
      onOpenSource={() => undefined}
    />,
  );
}

const labels = () =>
  screen
    .queryAllByRole('article', { name: /^(Your question|Deine Frage)$/ })
    .map((q) => q.textContent);

describe('transcript label of a summary (O4)', () => {
  it('shows the level, or plain "Summarize" for one stored without it', () => {
    renderTranscript([
      summary('m1', 1, 'veryShort'),
      summary('m2', 2, 'short'),
      summary('m3', 3, 'standard'),
      summary('m4', 4, 'detailed'),
      summary('m5', 5),
      summary('m6', 6, null),
    ]);
    expect(labels()).toEqual([
      'Summarize · Very short',
      'Summarize · Short',
      'Summarize · Standard',
      'Summarize · Detailed',
      'Summarize',
      'Summarize',
    ]);
  });

  it('shows the level of a summary on its way', () => {
    renderTranscript([], live('short'));
    expect(labels()).toEqual(['Summarize · Short']);
  });

  it('reads in German', () => {
    useLocale('de');
    renderTranscript([summary('m1', 1, 'short'), summary('m2', 2, 'detailed'), summary('m3', 3)]);
    expect(labels()).toEqual([
      'Zusammenfassen · Kurz',
      'Zusammenfassen · Ausführlich',
      'Zusammenfassen',
    ]);
  });
});
