import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { Repository } from '@/shared/db/repository';
import { getSettings, updateSettings } from '@/shared/settings';
import { freshRepository, renderSidebar, titleButton } from './helpers/sidebar';

let repo: Repository;

afterEach(() => {
  cleanup();
  repo.close();
});

/** Three sessions, most recent first: Gamma (2 pins), Beta, Alpha. Beta is active. */
async function seed() {
  repo = await freshRepository();
  const alpha = await repo.createSession({ providerId: null, model: null, title: 'Alpha' });
  const beta = await repo.createSession({ providerId: null, model: null, title: 'Beta' });
  const gamma = await repo.createSession({ providerId: null, model: null });
  await repo.addPin(gamma.id, { url: 'https://a.example/', title: 'A', kind: 'page' });
  await repo.addPin(gamma.id, { url: 'https://b.example/', title: 'B', kind: 'page' });
  await repo.addMessage(beta.id, { role: 'user', text: 'hello' });
  await repo.addPin(beta.id, { url: 'https://c.example/', title: 'C', kind: 'page' });
  // Beta is now the most recent; bump Gamma above it.
  await repo.addMessage(gamma.id, { role: 'user', text: 'hi' });
  await updateSettings({ activeSessionId: beta.id });
  await renderSidebar(repo);
  return { alpha, beta, gamma };
}

async function openDrawer() {
  fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
  return screen.findByRole('dialog', { name: 'Sessions' });
}

function rowTitles(drawer: HTMLElement): string[] {
  return within(drawer)
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.session-item-title')?.textContent ?? '');
}

describe('sessions drawer', () => {
  it('lists sessions by last activity with relative time and pin count', async () => {
    await seed();
    const drawer = await openDrawer();
    expect(rowTitles(drawer)).toEqual(['New session', 'Beta', 'Alpha']);
    const metas = [...drawer.querySelectorAll('.session-item-meta')].map((m) => m.textContent);
    expect(metas[0]).toMatch(/ago · 2 pins$/);
    expect(metas[1]).toMatch(/ · 1 pin$/);
    expect(metas[2]).toMatch(/ · 0 pins$/);
    const active = within(drawer).getByRole('button', { current: true });
    expect(active.textContent).toContain('Beta');
    await waitFor(() => {
      expect(document.activeElement).toBe(within(drawer).getByRole('button', { name: 'Close' }));
    });
  });

  it('Escape closes the drawer and returns focus to the drawer button', async () => {
    await seed();
    const drawer = await openDrawer();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sessions' }));
    });
  });

  it('clicking a session switches to it, persists it and closes the drawer', async () => {
    const { alpha } = await seed();
    const drawer = await openDrawer();
    fireEvent.click(within(drawer).getByText('Alpha'));
    await waitFor(() => {
      expect(titleButton().textContent).toBe('Alpha');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Session tabs (0)' })).toBeTruthy();
    expect((await getSettings()).activeSessionId).toBe(alpha.id);
  });

  it('delete asks for confirmation, and Cancel keeps the session', async () => {
    await seed();
    const drawer = await openDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete “Alpha”' }));
    expect(
      within(drawer).getByText('Delete this session with its pins and messages?'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(within(drawer).getByRole('button', { name: 'Cancel' }));
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel' }));
    expect(rowTitles(drawer)).toEqual(['New session', 'Beta', 'Alpha']);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(drawer).getByRole('button', { name: 'Delete “Alpha”' }),
      );
    });
    expect(await repo.listSessions()).toHaveLength(3);
  });

  it('Escape cancels a pending delete without closing the drawer', async () => {
    await seed();
    const drawer = await openDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete “Alpha”' }));
    fireEvent.keyDown(within(drawer).getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(
      within(drawer).queryByText('Delete this session with its pins and messages?'),
    ).toBeNull();
  });

  it('deleting another session keeps the active one', async () => {
    const { alpha, beta } = await seed();
    const drawer = await openDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete “Alpha”' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(rowTitles(drawer)).toEqual(['New session', 'Beta']);
    });
    expect(titleButton().textContent).toBe('Beta');
    expect(await repo.getSession(alpha.id)).toBeUndefined();
    expect((await getSettings()).activeSessionId).toBe(beta.id);
  });

  it('deleting the active session switches to the most recent remaining one', async () => {
    const { beta, gamma } = await seed();
    const drawer = await openDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete “Beta”' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(rowTitles(drawer)).toEqual(['New session', 'Alpha']);
    });
    expect(within(drawer).getByRole('button', { current: true }).textContent).toContain(
      'New session',
    );
    expect(screen.getByRole('button', { name: 'Session tabs (2)' })).toBeTruthy();
    expect((await getSettings()).activeSessionId).toBe(gamma.id);
    expect(await repo.listPins(beta.id)).toEqual([]);
    expect(await repo.listMessages(beta.id)).toEqual([]);
  });

  it('deleting the last session switches to a new empty session', async () => {
    repo = await freshRepository();
    const only = await repo.createSession({ providerId: null, model: null, title: 'Only' });
    await updateSettings({ activeSessionId: only.id });
    await renderSidebar(repo);
    const drawer = await openDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete “Only”' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(rowTitles(drawer)).toEqual(['New session']);
    });
    expect(titleButton().textContent).toBe('New session');
    const sessions = await repo.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).not.toBe(only.id);
    expect((await getSettings()).activeSessionId).toBe(sessions[0]?.id);
  });

  it('shows renamed titles', async () => {
    await seed();
    fireEvent.click(titleButton());
    const input = screen.getByRole('textbox', { name: 'Session title' });
    fireEvent.input(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(titleButton().textContent).toBe('Renamed');
    });
    const drawer = await openDrawer();
    expect(rowTitles(drawer)).toEqual(['New session', 'Renamed', 'Alpha']);
  });
});
