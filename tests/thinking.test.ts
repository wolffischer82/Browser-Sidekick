import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT_BUDGET, type ModelInfo, type ProviderConfig } from '@/shared/model';
import {
  modelInfoFor,
  requestThinking,
  sessionThinkingLevel,
  showsThinkingControl,
  THINKING_OPTIONS,
} from '@/shared/thinking';

// The rules behind the composer's thinking control (specs/thinking-levels.md
// 4.1, 4.2, 5): which level a session has, whether the control shows for the
// session's model, and what a request carries.

const SUPPORTED: ModelInfo = { thinking: 'supported' };
const UNSUPPORTED: ModelInfo = { thinking: 'unsupported' };

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    kind: 'openai-compatible',
    label: 'Local',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    defaultModel: 'yes',
    contextBudget: DEFAULT_CONTEXT_BUDGET,
    cachedModels: ['yes', 'no', 'plain'],
    modelInfo: { yes: SUPPORTED, no: UNSUPPORTED },
    hasAccess: true,
    ...patch,
  };
}

describe('THINKING_OPTIONS', () => {
  it('is Default, then the three levels in rising order', () => {
    expect(THINKING_OPTIONS).toEqual([null, 'low', 'medium', 'high']);
  });
});

describe('sessionThinkingLevel', () => {
  it.each([
    [{}, null],
    [{ thinkingLevel: undefined }, null],
    [{ thinkingLevel: null }, null],
    [{ thinkingLevel: 'low' }, 'low'],
    [{ thinkingLevel: 'medium' }, 'medium'],
    [{ thinkingLevel: 'high' }, 'high'],
  ] as const)('%j is %j', (session, level) => {
    expect(sessionThinkingLevel(session)).toBe(level);
  });

  it.each(['', 'max', 'HIGH', 3, true, {}])('damaged data (%j) is Default', (value) => {
    expect(sessionThinkingLevel({ thinkingLevel: value as never })).toBeNull();
  });
});

describe('modelInfoFor', () => {
  it('returns the stored info of a listed model', () => {
    expect(modelInfoFor(provider(), 'yes')).toBe(SUPPORTED);
    expect(modelInfoFor(provider(), 'no')).toBe(UNSUPPORTED);
  });

  it('is undefined (unknown) for a model without an entry', () => {
    expect(modelInfoFor(provider(), 'plain')).toBeUndefined();
    expect(modelInfoFor(provider(), 'typed-by-hand')).toBeUndefined();
  });

  it('is undefined for a provider cached before the feature, without a provider or a model', () => {
    expect(modelInfoFor(provider({ modelInfo: undefined }), 'yes')).toBeUndefined();
    expect(modelInfoFor(undefined, 'yes')).toBeUndefined();
    expect(modelInfoFor(provider(), null)).toBeUndefined();
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'a model id named like an inherited member (%s) is unknown (decisions.md T13-3)',
    (id) => {
      expect(modelInfoFor(provider(), id)).toBeUndefined();
      expect(modelInfoFor(provider({ modelInfo: {} }), id)).toBeUndefined();
    },
  );

  it('finds an own entry even under such a name', () => {
    const info = Object.fromEntries([['__proto__', UNSUPPORTED]]);
    expect(modelInfoFor(provider({ modelInfo: info }), '__proto__')).toBe(UNSUPPORTED);
  });

  it('treats a damaged entry as unknown', () => {
    const damaged = { yes: null, no: 'unsupported', odd: { thinking: 'maybe' } } as never;
    for (const id of ['yes', 'no', 'odd']) {
      expect(modelInfoFor(provider({ modelInfo: damaged }), id)).toBeUndefined();
    }
  });
});

describe('showsThinkingControl (spec 4.1)', () => {
  it('shows for a supported and for an unknown model', () => {
    expect(showsThinkingControl(provider(), 'yes')).toBe(true);
    expect(showsThinkingControl(provider(), 'plain')).toBe(true);
    expect(showsThinkingControl(provider({ modelInfo: undefined }), 'no')).toBe(true);
    expect(showsThinkingControl(provider(), 'constructor')).toBe(true);
  });

  it('is hidden for a model known not to support thinking', () => {
    expect(showsThinkingControl(provider(), 'no')).toBe(false);
  });

  it('is hidden without a provider or without a model', () => {
    expect(showsThinkingControl(undefined, 'yes')).toBe(false);
    expect(showsThinkingControl(provider(), null)).toBe(false);
    expect(showsThinkingControl(provider(), '')).toBe(false);
    expect(showsThinkingControl(undefined, null)).toBe(false);
  });

  it('does not depend on the provider kind', () => {
    for (const kind of ['openai-compatible', 'anthropic', 'gemini'] as const) {
      expect(showsThinkingControl(provider({ kind }), 'yes')).toBe(true);
      expect(showsThinkingControl(provider({ kind }), 'no')).toBe(false);
    }
  });
});

describe('requestThinking', () => {
  it('carries the session level and the model info while the control shows', () => {
    expect(requestThinking({ thinkingLevel: 'high' }, provider(), 'yes')).toEqual({
      level: 'high',
      info: SUPPORTED,
    });
    expect(requestThinking({ thinkingLevel: 'low' }, provider(), 'plain')).toEqual({
      level: 'low',
      info: undefined,
    });
  });

  it('is present at Default too, with a null level', () => {
    expect(requestThinking({}, provider(), 'yes')).toEqual({ level: null, info: SUPPORTED });
    expect(requestThinking({ thinkingLevel: null }, provider(), 'plain')).toEqual({
      level: null,
      info: undefined,
    });
  });

  it('sends no level while the control is hidden, whatever is stored', () => {
    expect(requestThinking({ thinkingLevel: 'high' }, provider(), 'no')).toEqual({
      level: null,
      info: UNSUPPORTED,
    });
  });

  it('keeps Anthropic mode and output cap in the info', () => {
    const info: ModelInfo = {
      thinking: 'supported',
      thinkingMode: 'budget',
      maxOutputTokens: 8192,
    };
    expect(
      requestThinking(
        { thinkingLevel: 'medium' },
        provider({ kind: 'anthropic', modelInfo: { claude: info } }),
        'claude',
      ),
    ).toEqual({ level: 'medium', info });
  });
});
