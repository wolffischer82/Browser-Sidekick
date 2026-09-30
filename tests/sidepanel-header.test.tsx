import { cleanup, fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { Repository } from '@/shared/db/repository';
import { getSettings, updateSettings } from '@/shared/settings';
import { freshRepository, renderSidebar, titleButton } from './helpers/sidebar';

let repo: Repository;

afterEach(() => {
  cleanup();
  repo.close();
});

async function activeSession() {
  const { activeSessionId } = await getSettings();
  return repo.getSession(activeSessionId ?? '');
}

function titleInput(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Session title' });
}

describe('header', () => {
  it('has labelled controls for the drawer, New session and settings', async () => {
    repo = await freshRepository();
    await renderSidebar(repo);
    for (const name of ['Sessions', 'New session', 'Settings']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('New session creates an empty session, shows it and makes it active', async () => {
    repo = await freshRepository();
    const old = await repo.createSession({ providerId: null, model: null, title: 'Old' });
    await updateSettings({ activeSessionId: old.id });
    await renderSidebar(repo);
    expect(titleButton().textContent).toBe('Old');
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    await waitFor(() => {
      expect(titleButton().textContent).toBe('New session');
    });
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
