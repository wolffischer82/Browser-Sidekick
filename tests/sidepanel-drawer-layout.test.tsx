import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  SessionsDrawer,
  type SessionSummary,
} from '@/entrypoints/sidepanel/components/SessionsDrawer';
import type { Session } from '@/shared/model';
import { useLocale, type Locale } from './helpers/i18n';
import { STYLE_PATH } from './helpers/style';

// The drawer's layout (redesign spec 5.6), rendered on its own with a fixed
// "now": Wednesday 7 October 2026, 12:00 local time. The week started on
// Monday the 5th.
const at = (day: number, hour = 12, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const NOW = at(7);

afterEach(() => {
  cleanup();
});

function summary(id: string, title: string, updatedAt: number, pinCount = 0): SessionSummary {
  const session: Session = {
    id,
    title,
    titleSource: 'user',
    providerId: null,
    model: null,
    createdAt: updatedAt,
    updatedAt,
  };
  return { session, title, pinCount };
}

/** Most recent first, as the sidebar lists them. */
const SESSIONS = [
  summary('a', 'Rust async runtimes', at(7, 11, 58), 4),
  summary('b', 'Flat hunting in Leipzig', at(7, 0, 0), 6),
  summary('c', 'Postgres indexing', at(6, 23, 59), 2),
  summary('d', 'Side panel API notes', at(5, 0, 0), 3),
  summary('e', 'Espresso grinders compared', at(4, 23, 59), 5),
  summary('f', 'Trip planning: Lisbon', at(1), 1),
];

function renderDrawer(
  options: { sessions?: SessionSummary[]; activeId?: string; locale?: Locale; now?: number } = {},
) {
  fakeBrowser.reset();
  useLocale(options.locale ?? 'en');
  const handlers = {
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onNewSession: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <SessionsDrawer
      sessions={options.sessions ?? SESSIONS}
      activeId={options.activeId ?? 'a'}
      now={options.now ?? NOW}
      {...handlers}
    />,
  );
  return { drawer: screen.getByRole('dialog'), ...handlers };
}

function groups(drawer: HTMLElement): [string, string[]][] {
  return [...drawer.querySelectorAll('.session-group')].map((group) => [
    group.querySelector('h3')?.textContent ?? '',
    [...group.querySelectorAll('.session-item-title')].map((t) => t.textContent),
  ]);
}

describe('sessions drawer groups', () => {
  it('groups sessions under Today, This week and Earlier, keeping their order', () => {
    const { drawer } = renderDrawer();
    expect(groups(drawer)).toEqual([
      ['Today', ['Rust async runtimes', 'Flat hunting in Leipzig']],
      ['This week', ['Postgres indexing', 'Side panel API notes']],
      ['Earlier', ['Espresso grinders compared', 'Trip planning: Lisbon']],
    ]);
  });

  it('names each group by its label and lists its rows', () => {
    const { drawer } = renderDrawer();
    const today = within(drawer).getByRole('region', { name: 'Today' });
    expect(within(today).getAllByRole('listitem')).toHaveLength(2);
    const label = within(today).getByRole('heading', { name: 'Today' });
    expect(label.className).toContain('section-label');
  });

  it('leaves out empty groups', () => {
    const { drawer } = renderDrawer({
      sessions: SESSIONS.filter((s) => s.session.id === 'a' || s.session.id === 'f'),
    });
    expect(groups(drawer).map(([label]) => label)).toEqual(['Today', 'Earlier']);
  });

  it('has no This week group on a Monday', () => {
    // Monday 12 October, 09:00: Sunday night already counts as earlier.
    const { drawer } = renderDrawer({
      now: at(12, 9),
      sessions: [
        summary('x', 'Since midnight', at(12, 0, 0)),
        summary('y', 'Sunday night', at(11, 23, 59)),
        summary('z', 'Last Friday', at(9)),
      ],
      activeId: 'x',
    });
    expect(groups(drawer)).toEqual([
      ['Today', ['Since midnight']],
      ['Earlier', ['Sunday night', 'Last Friday']],
    ]);
  });

  it('uses the German labels', () => {
    const { drawer } = renderDrawer({ locale: 'de' });
    expect(groups(drawer).map(([label]) => label)).toEqual(['Heute', 'Diese Woche', 'Früher']);
  });
});

describe('sessions drawer rows', () => {
  it('marks the active row with the dot and aria-current, and only that row', () => {
    const { drawer } = renderDrawer({ activeId: 'c' });
    const active = within(drawer).getByRole('button', { current: true });
    expect(active.textContent).toContain('Postgres indexing');
    expect(active.querySelector('.session-item-dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(drawer.querySelectorAll('.session-item-dot')).toHaveLength(1);
  });

  it('keeps the relative time and pin count line', () => {
    const { drawer } = renderDrawer();
    const metas = [...drawer.querySelectorAll('.session-item-meta')].map((m) => m.textContent);
    expect(metas[0]).toBe('2 minutes ago · 4 pins');
    expect(metas[5]).toBe('6 days ago · 1 pin');
  });

  it('gives every row a delete button in the tab order, right after the row', () => {
    const { drawer } = renderDrawer();
    for (const { title } of SESSIONS) {
      const remove = within(drawer).getByRole('button', { name: `Delete “${title}”` });
      expect(remove.className).toContain('session-delete');
      expect(remove.tabIndex).toBe(0);
      expect(remove.previousElementSibling?.textContent).toContain(title);
    }
  });

  it('shows delete only on row hover and focus within (style sheet)', () => {
    const css = readFileSync(STYLE_PATH, 'utf8');
    const rule = /\.session-row:not\(:hover, :focus-within\) \.session-delete \{([^}]*)\}/.exec(
      css,
    );
    expect(rule?.[1]).toContain('clip-path: inset(50%)');
    expect(rule?.[1]).not.toContain('display: none');
  });

  it('turns a row into the confirm card with the existing wording', () => {
    const { drawer, onDelete } = renderDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete “Postgres indexing”' }));
    const card = within(drawer).getByRole('group', { name: 'Postgres indexing' });
    expect(card.className).toContain('session-confirm');
    expect(within(card).getByText('Delete this session with its pins and messages?')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('c');
  });
});

describe('New session in the drawer', () => {
  it('is a full-width button under the header that starts a new session', () => {
    const { drawer, onNewSession, onClose } = renderDrawer();
    const button = within(drawer).getByRole('button', { name: 'New session' });
    expect(button.className).toContain('drawer-new-session');
    expect(button.querySelector('svg')).toBeTruthy();
    expect(button.previousElementSibling?.className).toBe('drawer-header');
    fireEvent.click(button);
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is labelled in German', () => {
    const { drawer } = renderDrawer({ locale: 'de' });
    expect(within(drawer).getByRole('button', { name: 'Neue Sitzung' })).toBeTruthy();
  });
});
