import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT_BUDGET, type ProviderConfig, type Session } from '@/shared/model';
import {
  emptyDraft,
  maskKey,
  modelGroups,
  normaliseDefault,
  originPattern,
  providerOriginPattern,
  resolveSessionModel,
  validateDraft,
  type ProviderDraft,
} from '@/shared/providers';

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

function session(patch: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: '',
    titleSource: 'fallback',
    providerId: null,
    model: null,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

describe('originPattern', () => {
  it.each([
    ['https://openrouter.ai/api/v1', true, 'https://openrouter.ai/*'],
    ['http://localhost:11434/v1', true, 'http://localhost:11434/*'],
    ['http://localhost:11434/v1', false, 'http://localhost/*'],
    ['https://gateway.example.com:443/v1/', true, 'https://gateway.example.com/*'],
    ['http://127.0.0.1:1234', true, 'http://127.0.0.1:1234/*'],
    ['  https://api.groq.com/openai/v1  ', true, 'https://api.groq.com/*'],
    ['HTTPS://API.Example.COM/v1', true, 'https://api.example.com/*'],
  ])('%s (port: %s) -> %s', (url, includePort, pattern) => {
    expect(originPattern(url, { includePort })).toBe(pattern);
  });

  it.each(['', 'not a url', 'ftp://example.com', 'file:///tmp/x', 'javascript:alert(1)'])(
    'rejects %j',
    (url) => {
      expect(originPattern(url, { includePort: true })).toBeNull();
    },
  );

  it('uses the fixed host for native providers, whatever the stored base URL', () => {
    expect(
      providerOriginPattern({ kind: 'anthropic', baseUrl: 'https://evil.example' }, true),
    ).toBe('https://api.anthropic.com/*');
    expect(providerOriginPattern({ kind: 'gemini', baseUrl: '' }, true)).toBe(
      'https://generativelanguage.googleapis.com/*',
    );
    expect(
      providerOriginPattern(
        { kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
        true,
      ),
    ).toBe('https://api.openai.com/*');
  });
});

describe('maskKey', () => {
  it('shows only the last four characters', () => {
    expect(maskKey('sk-proj-abcdefgh1234')).toBe('••••1234');
  });

  it('hides short keys completely', () => {
    expect(maskKey('abcdefg')).toBe('••••');
    expect(maskKey('ab')).toBe('••••');
  });

  it('is empty without a key', () => {
    expect(maskKey('')).toBe('');
  });
});

describe('normaliseDefault', () => {
  const a = provider({ id: 'a' });
  const b = provider({ id: 'b' });
  const noAccess = provider({ id: 'x', hasAccess: false });

  it('keeps a usable default', () => {
    expect(normaliseDefault([a, b], 'b')).toBe('b');
  });

  it('picks the first usable provider when the default is missing or unusable', () => {
    expect(normaliseDefault([noAccess, b], null)).toBe('b');
    expect(normaliseDefault([noAccess, b], 'gone')).toBe('b');
    expect(normaliseDefault([noAccess, b], 'x')).toBe('b');
  });

  it('is null without a usable provider', () => {
    expect(normaliseDefault([noAccess], 'x')).toBeNull();
    expect(normaliseDefault([], null)).toBeNull();
  });
});

describe('modelGroups', () => {
  it('lists usable providers with their cached models, the default model first if missing', () => {
    const groups = modelGroups([
      provider({ id: 'a', label: 'A', cachedModels: ['m1', 'm2'], defaultModel: 'm2' }),
      provider({ id: 'b', label: 'B', cachedModels: ['m1'], defaultModel: 'custom' }),
      provider({ id: 'c', label: 'C', cachedModels: null, defaultModel: 'only' }),
      provider({ id: 'x', label: 'X', hasAccess: false }),
    ]);
    expect(groups).toEqual([
      { providerId: 'a', label: 'A', models: ['m1', 'm2'] },
      { providerId: 'b', label: 'B', models: ['custom', 'm1'] },
      { providerId: 'c', label: 'C', models: ['only'] },
    ]);
  });
});

describe('resolveSessionModel', () => {
  const def = provider({ id: 'def', defaultModel: 'd-model' });
  const other = provider({ id: 'other', defaultModel: 'o-model' });

  it('keeps an existing provider and model', () => {
    expect(
      resolveSessionModel(session({ providerId: 'other', model: 'x' }), [def, other], 'def'),
    ).toEqual({ providerId: 'other', model: 'x', change: 'none' });
  });

  it('keeps a provider that lost access; the dropdown shows it as unavailable', () => {
    const lost = provider({ id: 'lost', hasAccess: false });
    expect(
      resolveSessionModel(session({ providerId: 'lost', model: 'm' }), [def, lost], 'def'),
    ).toEqual({ providerId: 'lost', model: 'm', change: 'none' });
  });

  it('moves a session on a deleted provider to the default', () => {
    expect(
      resolveSessionModel(session({ providerId: 'gone', model: 'm' }), [def, other], 'def'),
    ).toEqual({ providerId: 'def', model: 'd-model', change: 'deleted' });
  });

  it('clears a deleted provider when there is no default', () => {
    expect(resolveSessionModel(session({ providerId: 'gone', model: 'm' }), [], null)).toEqual({
      providerId: null,
      model: null,
      change: 'deleted',
    });
  });

  it('gives a session without a provider the default', () => {
    expect(resolveSessionModel(session(), [def], 'def')).toEqual({
      providerId: 'def',
      model: 'd-model',
      change: 'unset',
    });
    expect(resolveSessionModel(session({ providerId: 'def', model: null }), [def], 'def')).toEqual({
      providerId: 'def',
      model: 'd-model',
      change: 'unset',
    });
  });

  it('leaves a session without a provider alone when there is no default', () => {
    expect(resolveSessionModel(session(), [], null)).toEqual({
      providerId: null,
      model: null,
      change: 'none',
    });
  });
});

describe('validateDraft', () => {
  function draft(patch: Partial<ProviderDraft> = {}): ProviderDraft {
    return {
      ...emptyDraft('openai-compatible', 'OpenAI-compatible'),
      defaultModel: 'gpt-x',
      ...patch,
    };
  }

  it('prefills a draft per kind', () => {
    expect(emptyDraft('anthropic', 'Anthropic')).toEqual({
      kind: 'anthropic',
      label: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: '',
      defaultModel: '',
      contextBudget: String(DEFAULT_CONTEXT_BUDGET),
    });
    expect(emptyDraft('openai-compatible', 'X').baseUrl).toBe('https://api.openai.com/v1');
  });

  it('accepts a complete OpenAI-compatible draft without a key', () => {
    expect(validateDraft(draft(), { hasStoredKey: false })).toEqual({});
  });

  it('requires a label, a model and a whole-number budget in range', () => {
    expect(
      validateDraft(draft({ label: '  ', defaultModel: ' ', contextBudget: '12.5' }), {
        hasStoredKey: false,
      }),
    ).toEqual({
      label: 'errorLabelRequired',
      defaultModel: 'errorModelRequired',
      contextBudget: 'errorBudget',
    });
    for (const budget of ['', '999', '10000001', 'abc', '-5']) {
      expect(validateDraft(draft({ contextBudget: budget }), { hasStoredKey: false })).toEqual({
        contextBudget: 'errorBudget',
      });
    }
    expect(validateDraft(draft({ contextBudget: '1000' }), { hasStoredKey: false })).toEqual({});
  });

  it('requires an http(s) base URL for OpenAI-compatible', () => {
    expect(validateDraft(draft({ baseUrl: 'localhost:1234' }), { hasStoredKey: false })).toEqual({
      baseUrl: 'errorBaseUrl',
    });
  });

  it.each(['anthropic', 'gemini'] as const)(
    'requires a key for %s unless one is stored',
    (kind) => {
      const d = { ...emptyDraft(kind, kind), defaultModel: 'm' };
      expect(validateDraft(d, { hasStoredKey: false })).toEqual({ apiKey: 'errorKeyRequired' });
      expect(validateDraft(d, { hasStoredKey: true })).toEqual({});
      expect(validateDraft({ ...d, apiKey: 'k' }, { hasStoredKey: false })).toEqual({});
    },
  );
});
