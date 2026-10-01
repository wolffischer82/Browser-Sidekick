import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { LlmError } from '@/shared/llm';
import { llmErrorText } from '@/shared/llm-messages';
import { DEFAULT_CONTEXT_BUDGET, type ProviderConfig } from '@/shared/model';
import {
  accessPattern,
  hasHostAccess,
  requestHostAccess,
  syncProviderAccess,
  watchHostAccess,
} from '@/shared/provider-access';
import {
  makeDefaultProvider,
  removeProvider,
  setProviderAccess,
  storeProvider,
} from '@/shared/provider-settings';
import { getSettings, updateSettings } from '@/shared/settings';
import { useLocale } from './helpers/i18n';
import { fakePermissions, type FakePermissions } from './helpers/permissions';

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

let perms: FakePermissions;

beforeEach(() => {
  fakeBrowser.reset();
  useLocale('en');
  perms = fakePermissions();
});

describe('host access', () => {
  it('uses the origin with its port in Chrome builds', () => {
    expect(accessPattern(provider())).toBe('http://localhost:11434/*');
    expect(accessPattern({ kind: 'gemini', baseUrl: '' })).toBe(
      'https://generativelanguage.googleapis.com/*',
    );
    expect(accessPattern(provider({ baseUrl: 'nope' }))).toBeNull();
  });

  it('checks and requests one origin', async () => {
    expect(await hasHostAccess('http://localhost:11434/*')).toBe(false);
    expect(await requestHostAccess('http://localhost:11434/*')).toBe(true);
    expect(perms.requests).toEqual([['http://localhost:11434/*']]);
    expect(await hasHostAccess('http://localhost:11434/*')).toBe(true);
  });

  it('treats a declined or refused request as no access', async () => {
    perms.answer = 'decline';
    expect(await requestHostAccess('http://a.example/*')).toBe(false);
    perms.answer = 'throw';
    expect(await requestHostAccess('http://a.example/*')).toBe(false);
  });

  it('syncs stored access with the browser and keeps a usable default', async () => {
    const native = provider({ id: 'n', kind: 'anthropic', baseUrl: '', hasAccess: false });
    const local = provider({ id: 'l', hasAccess: true });
    await updateSettings({ providers: [local, native], defaultProviderId: 'l' });
    await syncProviderAccess();
    const settings = await getSettings();
    expect(settings.providers.map((p) => [p.id, p.hasAccess])).toEqual([
      ['l', false],
      ['n', true],
    ]);
    expect(settings.defaultProviderId).toBe('n');
  });

  it('notices a revoked native host', async () => {
    const native = provider({ id: 'n', kind: 'gemini', baseUrl: '' });
    await updateSettings({ providers: [native], defaultProviderId: 'n' });
    perms.granted.delete('https://generativelanguage.googleapis.com/*');
    await syncProviderAccess();
    const settings = await getSettings();
    expect(settings.providers[0]?.hasAccess).toBe(false);
    expect(settings.defaultProviderId).toBeNull();
  });

  it('does not write when nothing changed', async () => {
    await updateSettings({ providers: [provider({ kind: 'anthropic' })] });
    let writes = 0;
    fakeBrowser.storage.onChanged.addListener(() => (writes += 1));
    await syncProviderAccess();
    expect(writes).toBe(0);
  });

  it('reports permission changes until stopped', () => {
    let calls = 0;
    const stop = watchHostAccess(() => (calls += 1));
    perms.grant('http://x.example/*');
    perms.revoke('http://x.example/*');
    stop();
    perms.grant('http://y.example/*');
    expect(calls).toBe(2);
  });
});

describe('provider writes', () => {
  it('makes the first usable provider the default', async () => {
    await storeProvider(provider({ id: 'x', hasAccess: false }));
    expect((await getSettings()).defaultProviderId).toBeNull();
    await storeProvider(provider({ id: 'a' }));
    await storeProvider(provider({ id: 'b' }));
    expect((await getSettings()).defaultProviderId).toBe('a');
  });

  it('replaces a provider with the same id', async () => {
    await storeProvider(provider({ id: 'a', label: 'Old' }));
    await storeProvider(provider({ id: 'a', label: 'New' }));
    expect((await getSettings()).providers.map((p) => p.label)).toEqual(['New']);
  });

  it('makes only a usable provider the default', async () => {
    await storeProvider(provider({ id: 'a' }));
    await storeProvider(provider({ id: 'x', hasAccess: false }));
    await storeProvider(provider({ id: 'b' }));
    await makeDefaultProvider('x');
    expect((await getSettings()).defaultProviderId).toBe('a');
    await makeDefaultProvider('b');
    expect((await getSettings()).defaultProviderId).toBe('b');
  });

  it('picks a new default when the default is deleted', async () => {
    await storeProvider(provider({ id: 'a' }));
    await storeProvider(provider({ id: 'b' }));
    await removeProvider('a');
    const settings = await getSettings();
    expect(settings.providers.map((p) => p.id)).toEqual(['b']);
    expect(settings.defaultProviderId).toBe('b');
    await removeProvider('b');
    expect(await getSettings()).toMatchObject({ providers: [], defaultProviderId: null });
  });

  it('records granted access and then allows the provider as default', async () => {
    await storeProvider(provider({ id: 'x', hasAccess: false }));
    await setProviderAccess('x', true);
    expect(await getSettings()).toMatchObject({ defaultProviderId: 'x' });
  });
});

describe('llmErrorText', () => {
  it('maps every code to a static message', () => {
    expect(llmErrorText(new LlmError('invalid-key', { providerMessage: 'secret-ish' }))).toEqual({
      message: 'The API key was rejected. Check the key and try again.',
      detail: null,
    });
    expect(llmErrorText(new LlmError('network')).message).toBe(
      "The provider couldn't be reached. Check the base URL and your connection.",
    );
  });

  it("adds the provider's message for rejected and too-long requests", () => {
    expect(
      llmErrorText(new LlmError('bad-request', { status: 400, providerMessage: 'bad param' })),
    ).toEqual({
      message: 'The provider rejected the request. Check the settings and try again.',
      detail: 'Provider message: bad param',
    });
    expect(llmErrorText(new LlmError('context-too-long')).detail).toBeNull();
  });

  it('tells the user to set thinking back to Default, without the provider text', () => {
    expect(
      llmErrorText(
        new LlmError('thinking-unsupported', { status: 400, providerMessage: 'no effort here' }),
      ),
    ).toEqual({
      message: "This model doesn't accept a thinking level. Set thinking to Default and try again.",
      detail: null,
    });
    // The stored code alone (after a reload) gives the same text.
    expect(llmErrorText(new LlmError('thinking-unsupported'))).toEqual({
      message: "This model doesn't accept a thinking level. Set thinking to Default and try again.",
      detail: null,
    });
  });
});
