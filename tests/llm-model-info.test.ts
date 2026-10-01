// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createProvider, DEFAULT_BASE_URLS, type ModelList } from '../src/shared/llm';
import type { ProviderKind } from '../src/shared/model';
import { guardGlobalFetch, jsonResponse, KEY, mockFetch } from './helpers/llm-fetch';

/** Capability discovery in `listModels` (specs/thinking-levels.md 4.2). */

guardGlobalFetch();

async function list(kind: ProviderKind, body: unknown): Promise<ModelList> {
  const { fetch } = mockFetch(() => jsonResponse(200, body));
  return createProvider(
    { kind, baseUrl: DEFAULT_BASE_URLS[kind], apiKey: KEY },
    { fetch },
  ).listModels();
}

const yes = { supported: true };
const no = { supported: false };

describe('Anthropic model info', () => {
  const model = (id: string, extra: Record<string, unknown>) => ({ type: 'model', id, ...extra });
  const page = (...data: unknown[]) => ({ data, has_more: false, last_id: 'x' });

  it('reads effort mode, budget mode, unsupported and unknown, with the output cap', async () => {
    const result = await list(
      'anthropic',
      page(
        model('claude-effort', {
          max_tokens: 64000,
          max_input_tokens: 200000,
          capabilities: {
            effort: { supported: true, low: yes, medium: yes, high: yes, max: no },
            thinking: { supported: true, types: { adaptive: yes, enabled: yes } },
          },
        }),
        model('claude-budget', {
          max_tokens: 8192,
          capabilities: {
            effort: no,
            thinking: { supported: true, types: { adaptive: no, enabled: yes } },
          },
        }),
        // Adaptive thinking without effort is not effort mode.
        model('claude-adaptive-only', {
          max_tokens: 32000,
          capabilities: { thinking: { supported: true, types: { adaptive: yes, enabled: yes } } },
        }),
        // Effort without adaptive thinking is not effort mode either.
        model('claude-effort-only', {
          capabilities: {
            effort: yes,
            thinking: { supported: true, types: { adaptive: no, enabled: yes } },
          },
        }),
        model('claude-plain', {
          max_tokens: 4096,
          capabilities: {
            effort: no,
            thinking: { supported: false, types: { adaptive: no, enabled: no } },
          },
        }),
        model('claude-unknown', { max_tokens: 4096 }),
      ),
    );
    expect(result).toEqual({
      models: [
        'claude-effort',
        'claude-budget',
        'claude-adaptive-only',
        'claude-effort-only',
        'claude-plain',
        'claude-unknown',
      ],
      info: {
        'claude-effort': { thinking: 'supported', thinkingMode: 'effort', maxOutputTokens: 64000 },
        'claude-budget': { thinking: 'supported', thinkingMode: 'budget', maxOutputTokens: 8192 },
        'claude-adaptive-only': {
          thinking: 'supported',
          thinkingMode: 'budget',
          maxOutputTokens: 32000,
        },
        'claude-effort-only': { thinking: 'supported', thinkingMode: 'budget' },
        'claude-plain': { thinking: 'unsupported', maxOutputTokens: 4096 },
      },
    });
  });

  it.each([
    ['capabilities that are not an object', { capabilities: 'all' }],
    ['null capabilities', { capabilities: null }],
    ['capabilities as a list', { capabilities: [{ thinking: yes }] }],
    ['capabilities without a thinking entry', { capabilities: { vision: yes } }],
    ['a thinking entry that is not an object', { capabilities: { effort: yes, thinking: true } }],
  ])('treats %s as unknown', async (_label, extra) => {
    const result = await list('anthropic', page(model('claude-x', extra)));
    expect(result).toEqual({ models: ['claude-x'], info: {} });
  });

  it.each([
    ['flags that are not booleans', { types: { adaptive: { supported: 'yes' }, enabled: 1 } }],
    ['thinking types that are not an object', { types: 'adaptive' }],
    ['no thinking types', {}],
  ])('counts %s as not supported', async (_label, thinking) => {
    const result = await list(
      'anthropic',
      page(model('claude-x', { capabilities: { effort: { supported: 'yes' }, thinking } })),
    );
    expect(result).toEqual({
      models: ['claude-x'],
      info: { 'claude-x': { thinking: 'unsupported' } },
    });
  });

  it.each([[0], [-5], [1.5], ['64000'], [null]])('drops the output cap %j', async (cap) => {
    const result = await list(
      'anthropic',
      page(
        model('claude-x', {
          max_tokens: cap,
          capabilities: { effort: yes, thinking: { types: { adaptive: yes } } },
        }),
      ),
    );
    expect(result).toEqual({
      models: ['claude-x'],
      info: { 'claude-x': { thinking: 'supported', thinkingMode: 'effort' } },
    });
  });
});

describe('Gemini model info', () => {
  const model = (name: string, extra: Record<string, unknown> = {}) => ({
    name: `models/${name}`,
    supportedGenerationMethods: ['generateContent'],
    ...extra,
  });

  it('reads supported, unsupported and unknown from `thinking`', async () => {
    const result = await list('gemini', {
      models: [
        model('gemini-think', { thinking: true }),
        model('gemini-plain', { thinking: false }),
        model('gemini-old'),
      ],
    });
    expect(result).toEqual({
      models: ['gemini-think', 'gemini-plain', 'gemini-old'],
      info: {
        'gemini-think': { thinking: 'supported' },
        'gemini-plain': { thinking: 'unsupported' },
      },
    });
  });

  it.each([['true'], [1], [null], [{ supported: true }]])(
    'treats a `thinking` of %j as unknown',
    async (thinking) => {
      const result = await list('gemini', { models: [model('gemini-x', { thinking })] });
      expect(result).toEqual({ models: ['gemini-x'], info: {} });
    },
  );

  it('keeps no info for models it leaves out of the list', async () => {
    const result = await list('gemini', {
      models: [
        model('gemini-x', { thinking: true }),
        { name: 'models/embed', supportedGenerationMethods: ['embedContent'], thinking: false },
      ],
    });
    expect(result).toEqual({
      models: ['gemini-x'],
      info: { 'gemini-x': { thinking: 'supported' } },
    });
  });
});

describe('OpenAI-compatible model info', () => {
  it('reads supported, unsupported and unknown from `supported_parameters`', async () => {
    const result = await list('openai-compatible', {
      data: [
        {
          id: 'c/reasoning',
          supported_parameters: ['temperature', 'reasoning', 'include_reasoning'],
        },
        { id: 'b/effort', supported_parameters: ['reasoning_effort'] },
        { id: 'd/plain', supported_parameters: ['temperature', 'top_p'] },
        { id: 'e/empty', supported_parameters: [] },
        { id: 'a/unknown', object: 'model' },
      ],
    });
    expect(result).toEqual({
      models: ['a/unknown', 'b/effort', 'c/reasoning', 'd/plain', 'e/empty'],
      info: {
        'c/reasoning': { thinking: 'supported' },
        'b/effort': { thinking: 'supported' },
        'd/plain': { thinking: 'unsupported' },
        'e/empty': { thinking: 'unsupported' },
      },
    });
  });

  it.each([['reasoning'], [{ reasoning: true }], [null], [true]])(
    'treats a `supported_parameters` of %j as unknown',
    async (supported) => {
      const result = await list('openai-compatible', {
        data: [{ id: 'm', supported_parameters: supported }],
      });
      expect(result).toEqual({ models: ['m'], info: {} });
    },
  );

  it('ignores entries of the array that are not strings', async () => {
    const result = await list('openai-compatible', {
      data: [{ id: 'm', supported_parameters: [1, null, { name: 'reasoning' }] }],
    });
    expect(result).toEqual({ models: ['m'], info: { m: { thinking: 'unsupported' } } });
  });

  it('has no info for plain string entries and name-only lists', async () => {
    expect(await list('openai-compatible', { models: [{ name: 'llama3.2' }] })).toEqual({
      models: ['llama3.2'],
      info: {},
    });
    expect(await list('openai-compatible', { data: ['qwen3'] })).toEqual({
      models: ['qwen3'],
      info: {},
    });
  });

  it('keeps the first entry of a model listed twice', async () => {
    const result = await list('openai-compatible', {
      data: [
        { id: 'm', supported_parameters: ['reasoning'] },
        { id: 'm', supported_parameters: [] },
      ],
    });
    expect(result).toEqual({ models: ['m'], info: { m: { thinking: 'supported' } } });
  });

  it('stores a model called like an object member as its own key', async () => {
    const result = await list('openai-compatible', {
      data: [{ id: '__proto__', supported_parameters: ['reasoning'] }, { id: 'constructor' }],
    });
    expect(result.models).toEqual(['__proto__', 'constructor']);
    const info = 'info' in result ? result.info : {};
    expect(Object.keys(info)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(info)).toBe(Object.prototype);
  });
});
