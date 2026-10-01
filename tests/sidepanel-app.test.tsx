import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '@/entrypoints/sidepanel/App';
import type { Repository } from '@/shared/db/repository';
import { DEFAULT_CONTEXT_BUDGET } from '@/shared/model';
import { getSettings, updateSettings } from '@/shared/settings';
import { readMessages, type Locale } from './helpers/i18n';
import { freshRepository, renderSidebar, titleButton } from './helpers/sidebar';

let repo: Repository | undefined;

afterEach(() => {
  cleanup();
  repo?.close();
});

describe('sidebar root', () => {
  it.each<Locale>(['en', 'de'])('renders the localised heading and layout (%s)', async (locale) => {
    repo = await freshRepository(locale);
    const m = readMessages(locale);
    render(<App repository={Promise.resolve(repo)} />);
    await screen.findByTitle(m.renameSession?.message ?? '');
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(m.sidebarHeading?.message);
    expect(heading.textContent).toBe('Browser Sidekick');
    expect(screen.getByTitle(m.renameSession?.message ?? '').textContent).toBe(
      m.fallbackTitle?.message,
    );
    expect(
      screen.getByRole('button', { name: m.sessionTabsHeading?.message.replace('$COUNT$', '0') }),
    ).toBeTruthy();
    expect(screen.getByText(m.transcriptEmpty?.message ?? '')).toBeTruthy();
    expect(screen.getByRole('button', { name: m.summarize?.message })).toBeTruthy();
    expect(screen.getByPlaceholderText(m.inputPlaceholder?.message ?? '')).toBeTruthy();
  });

  it('creates an empty session on first run and stores it as active', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    const sessions = await repo.listSessions();
    expect(sessions).toHaveLength(1);
    expect((await getSettings()).activeSessionId).toBe(sessions[0]?.id);
  });

  it('opens on the stored active session', async () => {
    repo = await freshRepository();
    const a = await repo.createSession({ providerId: null, model: null, title: 'Alpha' });
    await repo.createSession({ providerId: null, model: null, title: 'Beta' });
    await updateSettings({ activeSessionId: a.id });
    await renderSidebar(repo);
    expect(titleButton().textContent).toBe('Alpha');
  });

  it('shows the load error when the repository cannot be opened', async () => {
    repo = await freshRepository();
    render(<App repository={Promise.reject(new Error('blocked'))} />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      readMessages('en').loadError?.message,
    );
  });
});

describe('session tabs frame', () => {
  it('collapses and remembers the state', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    const toggle = screen.getByRole('button', { name: 'Session tabs (0)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await waitFor(async () => {
      expect((await getSettings()).sessionTabsExpanded).toBe(false);
    });
    cleanup();
    await renderSidebar(repo);
    expect(
      screen.getByRole('button', { name: 'Session tabs (0)' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('counts the pins of the active session', async () => {
    repo = await freshRepository();
    const s = await repo.createSession({ providerId: null, model: null });
    await repo.addPin(s.id, { url: 'https://example.com/', title: 'Example', kind: 'page' });
    await updateSettings({ activeSessionId: s.id });
    await renderSidebar(repo);
    expect(screen.getByRole('button', { name: 'Session tabs (1)' })).toBeTruthy();
  });
});

describe('summarize and input', () => {
  it('keeps Summarize visible but unavailable with a tooltip', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    const button = screen.getByRole('button', { name: 'Summarize' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // No provider yet: the tooltip names that first (the states are T11's tests).
    const hint = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(hint?.getAttribute('role')).toBe('tooltip');
    expect(hint?.textContent).toBe(readMessages('en').summarizeNoProvider?.message);
  });

  it('disables the input with a settings link while no provider exists', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Ask about these pages…',
    });
    expect(input.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open settings' }));
    });
  });

  it('enables the input once a usable provider is saved', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    await updateSettings({
      providers: [
        {
          id: 'p1',
          kind: 'anthropic',
          label: 'Claude',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'k',
          defaultModel: 'm',
          contextBudget: DEFAULT_CONTEXT_BUDGET,
          cachedModels: null,
          hasAccess: true,
        },
      ],
    });
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Ask about these pages…' })
          .disabled,
      ).toBe(false);
    });
    expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull();
  });
});
