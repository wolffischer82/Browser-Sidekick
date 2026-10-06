import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { createRef } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { Header, SUBTITLE_REFRESH_MS } from '@/entrypoints/sidepanel/components/Header';
import { openRepository, type NewPin, type Repository } from '@/shared/db/repository';
import { getSettings, updateSettings } from '@/shared/settings';
import { useLocale, type Locale } from './helpers/i18n';
import { freshRepository, renderSidebar, titleButton } from './helpers/sidebar';

let repo: Repository | undefined;

afterEach(() => {
  cleanup();
  repo?.close();
  repo = undefined;
  vi.useRealTimers();
});

async function activeSession() {
  const { activeSessionId } = await getSettings();
  return repo?.getSession(activeSessionId ?? '');
}

function titleInput(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Session title' });
}

describe('header', () => {
  it('has Sessions, the title and Settings, and no New session (redesign spec O4)', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    const header = document.querySelector('header');
    expect([...(header?.querySelectorAll('button') ?? [])].map((b) => b.title)).toEqual([
      'Sessions',
      'Rename session',
      'Settings',
    ]);
    // The one New session button outside the drawer is in the composer.
    const newSession = screen.getByRole('button', { name: 'New session' });
    expect(header?.contains(newSession)).toBe(false);
    expect(newSession.closest('.composer-toolbar')).not.toBeNull();
  });

  it('New session in the composer creates an empty session, shows it and keeps focus', async () => {
    repo = await freshRepository();
    const old = await repo.createSession({ providerId: null, model: null, title: 'Old' });
    await updateSettings({ activeSessionId: old.id });
    await renderSidebar(repo);
    expect(titleButton().textContent).toBe('Old');
    const button = screen.getByRole('button', { name: 'New session' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => {
      expect(titleButton().textContent).toBe('New session');
    });
    // Focus stays on the button, as it did on the header's.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New session' }));
    const active = await activeSession();
    expect(active?.id).not.toBe(old.id);
    expect(active).toMatchObject({ title: '', titleSource: 'fallback' });
    expect(await repo.listSessions()).toHaveLength(2);
  });

  it('settings gear opens settings and Escape returns focus to it', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const back = screen.getByRole('button', { name: 'Back' });
    expect(screen.getByText('No providers saved yet.')).toBeTruthy();
    fireEvent.keyDown(back, { key: 'Escape' });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Settings' }));
    });
  });
});

describe('inline rename', () => {
  it('Enter saves a user title and returns focus to the title', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    fireEvent.click(titleButton());
    const input = titleInput();
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    expect(input.value).toBe('New session');
    fireEvent.input(input, { target: { value: '  Pricing research  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(titleButton().textContent).toBe('Pricing research');
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(titleButton());
    });
    expect(await activeSession()).toMatchObject({
      title: 'Pricing research',
      titleSource: 'user',
    });
  });

  it('leaving the field saves', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    fireEvent.click(titleButton());
    fireEvent.input(titleInput(), { target: { value: 'Blurred' } });
    fireEvent.blur(titleInput());
    await waitFor(() => {
      expect(titleButton().textContent).toBe('Blurred');
    });
  });

  it('Escape cancels without saving', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    fireEvent.click(titleButton());
    fireEvent.input(titleInput(), { target: { value: 'Discarded' } });
    fireEvent.keyDown(titleInput(), { key: 'Escape' });
    expect(titleButton().textContent).toBe('New session');
    await waitFor(() => {
      expect(document.activeElement).toBe(titleButton());
    });
    expect(await activeSession()).toMatchObject({ title: '', titleSource: 'fallback' });
  });

  it('an empty or unchanged title keeps the current one', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    fireEvent.click(titleButton());
    fireEvent.input(titleInput(), { target: { value: '   ' } });
    fireEvent.keyDown(titleInput(), { key: 'Enter' });
    fireEvent.click(titleButton());
    fireEvent.keyDown(titleInput(), { key: 'Enter' });
    expect(titleButton().textContent).toBe('New session');
    expect(await activeSession()).toMatchObject({ title: '', titleSource: 'fallback' });
  });

  it('shows a save error when the rename fails', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    repo.setSessionTitle = () => Promise.reject(new Error('quota'));
    fireEvent.click(titleButton());
    fireEvent.input(titleInput(), { target: { value: 'Nope' } });
    fireEvent.keyDown(titleInput(), { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toBe(
      "The change couldn't be saved. Try again.",
    );
  });
});

describe('inline rename edge cases', () => {
  it('a blur after Enter saves once and keeps the refocus', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    let calls = 0;
    const original = repo.setSessionTitle.bind(repo);
    repo.setSessionTitle = (...args) => {
      calls++;
      return original(...args);
    };
    fireEvent.click(titleButton());
    const input = titleInput();
    fireEvent.input(input, { target: { value: 'Once' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(titleButton().textContent).toBe('Once');
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(titleButton());
    });
    expect(calls).toBe(1);
  });
});

const subtitle = () => document.querySelector('.header-subtitle')?.textContent;

function pin(n: number): NewPin {
  return { url: `https://news.example/${String(n)}`, title: `Page ${String(n)}`, kind: 'page' };
}

/** Renders the header alone, `updatedAt` milliseconds before the fake clock's start. */
function renderHeader(pinCount: number, ago: number, locale: Locale = 'en') {
  fakeBrowser.reset();
  useLocale(locale);
  vi.useFakeTimers({ now: new Date('2026-10-03T12:00:00') });
  render(
    <Header
      title="Night trains"
      pinCount={pinCount}
      updatedAt={Date.now() - ago}
      drawerOpen={false}
      drawerButtonRef={createRef()}
      onOpenDrawer={() => undefined}
      onRename={() => undefined}
      onOpenSettings={() => undefined}
    />,
  );
}

describe('header subtitle (redesign spec 5.1)', () => {
  it('reads "No pins yet" for a session without pins, outside the rename button', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    expect(subtitle()).toBe('No pins yet');
    const button = screen.getByRole('button', { name: 'Session title: New session' });
    expect(button.contains(document.querySelector('.header-subtitle'))).toBe(false);
    expect(button.closest('header')?.querySelector('.header-subtitle')).not.toBeNull();
  });

  it('shows the pin count and the last activity of the session', async () => {
    repo = await freshRepository();
    const session = await repo.createSession({ providerId: null, model: null });
    await repo.addPin(session.id, pin(1));
    await repo.addPin(session.id, pin(2));
    await updateSettings({ activeSessionId: session.id });
    await renderSidebar(repo);
    // The test clock starts an hour back.
    expect(subtitle()).toMatch(/^2 pins · active (\d+ minutes|1 hour) ago$/);
    // The rename button's name is the title only.
    expect(screen.getByRole('button', { name: 'Session title: New session' })).toBe(titleButton());
  });

  it('uses the singular for one pin', () => {
    renderHeader(1, 5 * 60_000);
    expect(subtitle()).toBe('1 pin · active 5 minutes ago');
  });

  it('refreshes the relative time while shown', async () => {
    renderHeader(3, 10_000);
    expect(subtitle()).toBe('3 pins · active now');
    await act(() => {
      vi.advanceTimersByTime(SUBTITLE_REFRESH_MS);
    });
    expect(subtitle()).toBe('3 pins · active now');
    await act(() => {
      vi.advanceTimersByTime(SUBTITLE_REFRESH_MS);
    });
    expect(subtitle()).toBe('3 pins · active 1 minute ago');
    await act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(subtitle()).toBe('3 pins · active 3 minutes ago');
  });

  it('has no pins and no time in German either', () => {
    renderHeader(0, 60_000, 'de');
    expect(subtitle()).toBe('Noch keine Pins');
  });

  it('reads the German pin count and activity', () => {
    renderHeader(2, 2 * 60_000, 'de');
    expect(subtitle()).toBe('2 Pins · aktiv vor 2 Minuten');
  });

  it('follows the session when a question is stored', async () => {
    (await freshRepository()).close();
    let clock = Date.now() - 3 * 60 * 60 * 1000;
    repo = await openRepository({ now: () => clock });
    const session = await repo.createSession({ providerId: null, model: null });
    await repo.addPin(session.id, pin(1));
    await updateSettings({ activeSessionId: session.id });
    await renderSidebar(repo);
    expect(subtitle()).toBe('1 pin · active 3 hours ago');
    // Another sidebar stores a question; this one re-reads the session.
    clock = Date.now();
    await repo.addMessage(session.id, { role: 'user', kind: 'ask', text: 'Why?' });
    await fakeBrowser.runtime.sendMessage({ type: 'messages-changed', sessionId: session.id });
    await waitFor(() => {
      expect(subtitle()).toBe('1 pin · active now');
    });
  });
});
