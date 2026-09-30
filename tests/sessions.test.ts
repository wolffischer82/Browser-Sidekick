import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { openRepository, type Repository } from '@/shared/db/repository';
import { DEFAULT_CONTEXT_BUDGET, type ProviderConfig } from '@/shared/model';
import {
  activateSession,
  createActiveSession,
  deleteSessionAndResolveActive,
  newSessionInput,
  openActiveSession,
} from '@/shared/sessions';
import { getSettings, updateSettings } from '@/shared/settings';

let repo: Repository;
let clock = 1000;

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    kind: 'openai-compatible',
    label: 'Local',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    defaultModel: 'llama3',
    contextBudget: DEFAULT_CONTEXT_BUDGET,
    cachedModels: null,
    hasAccess: true,
    ...patch,
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  globalThis.indexedDB = new IDBFactory();
  clock = 1000;
  repo = await openRepository({ now: () => (clock += 10) });
});

afterEach(() => {
  repo.close();
});

describe('newSessionInput', () => {
  it('uses no provider when none is configured', () => {
    expect(newSessionInput({ providers: [], defaultProviderId: null })).toEqual({
      providerId: null,
      model: null,
    });
  });

  it('uses the default provider and its default model', () => {
    expect(
      newSessionInput({ providers: [provider(), provider({ id: 'p2' })], defaultProviderId: 'p1' }),
    ).toEqual({ providerId: 'p1', model: 'llama3' });
  });

  it('ignores a default provider without access or a dangling default id', () => {
    expect(
      newSessionInput({ providers: [provider({ hasAccess: false })], defaultProviderId: 'p1' }),
    ).toEqual({ providerId: null, model: null });
    expect(newSessionInput({ providers: [provider()], defaultProviderId: 'gone' })).toEqual({
      providerId: null,
      model: null,
    });
  });
});

describe('openActiveSession', () => {
  it('creates an empty fallback session on first run and makes it active', async () => {
    const session = await openActiveSession(repo);
    expect(session).toMatchObject({ title: '', titleSource: 'fallback' });
    expect(await repo.listSessions()).toHaveLength(1);
    expect((await getSettings()).activeSessionId).toBe(session.id);
  });

  it('returns the stored active session', async () => {
    const a = await repo.createSession({ providerId: null, model: null });
    await repo.createSession({ providerId: null, model: null });
    await updateSettings({ activeSessionId: a.id });
    expect((await openActiveSession(repo)).id).toBe(a.id);
    expect(await repo.listSessions()).toHaveLength(2);
  });

  it('falls back to the most recent session when the stored id is missing or stale', async () => {
    await repo.createSession({ providerId: null, model: null });
    const b = await repo.createSession({ providerId: null, model: null });
    expect((await openActiveSession(repo)).id).toBe(b.id);
    await updateSettings({ activeSessionId: 'deleted' });
    expect((await openActiveSession(repo)).id).toBe(b.id);
    expect((await getSettings()).activeSessionId).toBe(b.id);
  });

  it('starts the first session on the default provider', async () => {
    await updateSettings({ providers: [provider()], defaultProviderId: 'p1' });
    expect(await openActiveSession(repo)).toMatchObject({ providerId: 'p1', model: 'llama3' });
  });
});

describe('createActiveSession', () => {
  it('creates a session, lists it first and makes it active', async () => {
    await repo.createSession({ providerId: null, model: null });
    const created = await createActiveSession(repo);
    expect((await repo.listSessions())[0]?.id).toBe(created.id);
    expect((await getSettings()).activeSessionId).toBe(created.id);
  });
});

describe('activateSession', () => {
  it('stores the id and returns the session', async () => {
    const a = await repo.createSession({ providerId: null, model: null });
    expect((await activateSession(repo, a.id))?.id).toBe(a.id);
    expect((await getSettings()).activeSessionId).toBe(a.id);
  });

  it('returns undefined and changes nothing for an unknown id', async () => {
    await updateSettings({ activeSessionId: 'x' });
    expect(await activateSession(repo, 'nope')).toBeUndefined();
    expect((await getSettings()).activeSessionId).toBe('x');
  });
});

describe('deleteSessionAndResolveActive', () => {
  it('keeps the active session when another one is deleted', async () => {
    const a = await repo.createSession({ providerId: null, model: null });
    const b = await repo.createSession({ providerId: null, model: null });
    await updateSettings({ activeSessionId: a.id });
    const active = await deleteSessionAndResolveActive(repo, b.id, a.id);
    expect(active.id).toBe(a.id);
    expect((await repo.listSessions()).map((s) => s.id)).toEqual([a.id]);
  });

  it('switches to the most recent remaining session when the active one is deleted', async () => {
    const a = await repo.createSession({ providerId: null, model: null });
    const b = await repo.createSession({ providerId: null, model: null });
    const c = await repo.createSession({ providerId: null, model: null });
    await repo.addPin(a.id, { url: 'https://example.com/', title: 'Example', kind: 'page' });
    const active = await deleteSessionAndResolveActive(repo, b.id, b.id);
    expect(active.id).toBe(a.id);
    expect((await getSettings()).activeSessionId).toBe(a.id);
    expect((await repo.listSessions()).map((s) => s.id)).toEqual([a.id, c.id]);
  });

  it('creates a new empty session when the last one is deleted', async () => {
    const a = await repo.createSession({
      providerId: null,
      model: null,
      title: 'Old',
      titleSource: 'user',
    });
    await repo.addMessage(a.id, { role: 'user', text: 'hi' });
    const active = await deleteSessionAndResolveActive(repo, a.id, a.id);
    expect(active.id).not.toBe(a.id);
    expect(active).toMatchObject({ title: '', titleSource: 'fallback' });
    expect((await repo.listSessions()).map((s) => s.id)).toEqual([active.id]);
    expect(await repo.listMessages(a.id)).toEqual([]);
    expect((await getSettings()).activeSessionId).toBe(active.id);
  });
});
