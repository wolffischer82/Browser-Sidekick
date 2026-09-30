// Installs the IndexedDB globals for the "key never reaches IndexedDB" test.
import 'fake-indexeddb/auto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { openRepository } from '@/shared/db/repository';
import { openSidekickDb } from '@/shared/db/schema';
import { DEFAULT_CONTEXT_BUDGET, DEFAULT_SETTINGS, type ProviderConfig } from '@/shared/model';
import {
  clearSettingsForDeleteAll,
  deleteProvider,
  getSettings,
  saveProvider,
  updateSettings,
  watchSettings,
} from '@/shared/settings';

const SECRET = 'sk-test-secret-1234';

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    kind: 'openai-compatible',
    label: 'Local',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: SECRET,
    defaultModel: 'llama3',
    contextBudget: DEFAULT_CONTEXT_BUDGET,
    cachedModels: null,
    hasAccess: true,
    ...overrides,
  };
}

const syncMethods = ['get', 'set', 'remove', 'clear'] as const;

let syncSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  fakeBrowser.reset();
  syncSpies = syncMethods.map((method) => vi.spyOn(fakeBrowser.storage.sync, method));
});

afterEach(() => {
  // No settings operation in any test may touch sync storage (D5).
  for (const spy of syncSpies) expect(spy).not.toHaveBeenCalled();
});

describe('getSettings', () => {
  it('returns the defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual({
      providers: [],
      defaultProviderId: null,
      activeSessionId: null,
      sessionTabsExpanded: true,
      accessBannerDismissed: false,
    });
  });

  it('never shares the default providers array', async () => {
    const settings = await getSettings();
    settings.providers.push(provider());
    expect(DEFAULT_SETTINGS.providers).toEqual([]);
    expect((await getSettings()).providers).toEqual([]);
  });

  it('ignores unrelated keys in storage.local', async () => {
    await fakeBrowser.storage.local.set({ other: 1 });
    expect(await getSettings()).not.toHaveProperty('other');
  });
});

describe('updateSettings', () => {
  it('stores each field under its own storage.local key', async () => {
    await updateSettings({ activeSessionId: 's1', sessionTabsExpanded: false });
    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      activeSessionId: 's1',
      sessionTabsExpanded: false,
    });
    expect(await getSettings()).toMatchObject({
      activeSessionId: 's1',
      sessionTabsExpanded: false,
      accessBannerDismissed: false,
    });
  });

  it('leaves other fields untouched', async () => {
    await updateSettings({ activeSessionId: 's1' });
    await updateSettings({ accessBannerDismissed: true });
    expect(await getSettings()).toMatchObject({
      activeSessionId: 's1',
      accessBannerDismissed: true,
    });
  });

  it('skips undefined fields and unknown keys, and writes nothing for an empty patch', async () => {
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');
    await updateSettings({ activeSessionId: undefined });
    await updateSettings({ unknown: 1 } as never);
    expect(set).not.toHaveBeenCalled();
  });
});

describe('providers', () => {
  it('adds and replaces providers by id', async () => {
    await saveProvider(provider());
    await saveProvider(provider({ id: 'p2', kind: 'anthropic', label: 'Claude' }));
    await saveProvider(provider({ label: 'Local (renamed)' }));
    const { providers } = await getSettings();
    expect(providers.map((p) => [p.id, p.label])).toEqual([
      ['p1', 'Local (renamed)'],
      ['p2', 'Claude'],
    ]);
  });

  it('deletes a provider and clears the default when it was the default', async () => {
    await saveProvider(provider());
    await saveProvider(provider({ id: 'p2' }));
    await updateSettings({ defaultProviderId: 'p1' });

    await deleteProvider('p2');
    expect(await getSettings()).toMatchObject({ defaultProviderId: 'p1' });
    await deleteProvider('p1');
    expect(await getSettings()).toMatchObject({ providers: [], defaultProviderId: null });
  });

  it('writes the API key to storage.local only', async () => {
    const localSet = vi.spyOn(fakeBrowser.storage.local, 'set');
    const sessionSet = vi.spyOn(fakeBrowser.storage.session, 'set');
    await saveProvider(provider());
    expect(JSON.stringify(localSet.mock.calls)).toContain(SECRET);
    expect(sessionSet).not.toHaveBeenCalled();
    expect((await getSettings()).providers[0]?.apiKey).toBe(SECRET);
  });
});

describe('clearSettingsForDeleteAll', () => {
  beforeEach(async () => {
    await saveProvider(provider());
    await updateSettings({
      defaultProviderId: 'p1',
      activeSessionId: 's1',
      sessionTabsExpanded: false,
      accessBannerDismissed: true,
    });
  });

  it('keeps providers unless asked to remove them', async () => {
    await clearSettingsForDeleteAll({ includeProviders: false });
    expect(await getSettings()).toMatchObject({
      activeSessionId: null,
      defaultProviderId: 'p1',
      providers: [provider()],
      sessionTabsExpanded: false,
      accessBannerDismissed: true,
    });
  });

  it('removes providers and their keys when asked', async () => {
    await clearSettingsForDeleteAll({ includeProviders: true });
    expect(await getSettings()).toMatchObject({
      activeSessionId: null,
      defaultProviderId: null,
      providers: [],
      sessionTabsExpanded: false,
      accessBannerDismissed: true,
    });
    expect(JSON.stringify(await fakeBrowser.storage.local.get(null))).not.toContain(SECRET);
  });
});

describe('watchSettings', () => {
  it('reports changed fields from storage.local until stopped', async () => {
    const listener = vi.fn();
    const stop = watchSettings(listener);

    await updateSettings({ activeSessionId: 's2' });
    expect(listener).toHaveBeenLastCalledWith({ activeSessionId: 's2' });

    await clearSettingsForDeleteAll({ includeProviders: false });
    expect(listener).toHaveBeenLastCalledWith({ activeSessionId: null });

    await fakeBrowser.storage.local.set({ other: 1 });
    await fakeBrowser.storage.session.set({ activeSessionId: 'ignored' });
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    await updateSettings({ activeSessionId: 's3' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('reports a removed field as its default', async () => {
    await saveProvider(provider());
    const listener = vi.fn();
    watchSettings(listener);
    await clearSettingsForDeleteAll({ includeProviders: true });
    expect(listener).toHaveBeenCalledWith({
      activeSessionId: null,
      providers: [],
      defaultProviderId: null,
    });
  });
});

describe('API keys stay in storage.local', () => {
  it('never reaches IndexedDB', async () => {
    globalThis.indexedDB = new IDBFactory();
    await saveProvider(provider());
    const { providers } = await getSettings();
    const p = providers[0];
    if (!p) throw new Error('provider missing');

    const repo = await openRepository();
    const session = await repo.createSession({ providerId: p.id, model: p.defaultModel });
    await repo.addPin(session.id, { url: 'https://example.com/', title: 'Example', kind: 'page' });
    await repo.addMessage(session.id, {
      role: 'assistant',
      text: 'Answer',
      providerLabel: p.label,
      model: p.defaultModel,
    });
    repo.close();

    const db = await openSidekickDb();
    const dump = JSON.stringify([
      await db.getAll('sessions'),
      await db.getAll('pins'),
      await db.getAll('messages'),
    ]);
    db.close();
    expect(dump).not.toContain(SECRET);
  });

  it('no source file uses sync storage', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/storage\s*\.\s*sync|['"`]sync:/.test(readFileSync(path, 'utf8'))) {
          offenders.push(path);
        }
      }
    };
    walk(resolve(__dirname, '../src'));
    expect(offenders).toEqual([]);
  });
});
