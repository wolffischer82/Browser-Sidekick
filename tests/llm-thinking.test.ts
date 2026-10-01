// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createProvider,
  DEFAULT_BASE_URLS,
  type LlmRequest,
  type ModelInfo,
  type ThinkingLevel,
} from '../src/shared/llm';
import { ANTHROPIC_DEFAULT_MAX_TOKENS } from '../src/shared/llm/anthropic';
import { errorFromResponse } from '../src/shared/llm/errors';
import type { ProviderKind } from '../src/shared/model';
import {
  collect,
  guardGlobalFetch,
  jsonResponse,
  KEY,
  mockFetch,
  REQUEST,
  sseResponse,
} from './helpers/llm-fetch';

/**
 * Thinking level in requests (specs/thinking-levels.md 4.3) and the
 * `thinking-unsupported` error (4.6). One table row per row of the spec's
 * mapping tables; each expectation is the whole request body.
 */

guardGlobalFetch();

type Level = ThinkingLevel | null;
const LEVELS: ThinkingLevel[] = ['low', 'medium', 'high'];

interface Sent {
  /** The parsed body. */
  body: Record<string, unknown>;
  /** The body as sent. */
  raw: string;
}

async function send(kind: ProviderKind, request: LlmRequest, baseUrl?: string): Promise<Sent> {
  const { fetch, calls } = mockFetch(() => sseResponse([]));
  const provider = createProvider(
    { kind, baseUrl: baseUrl ?? DEFAULT_BASE_URLS[kind], apiKey: KEY },
    { fetch },
  );
  await collect(provider, request);
  const raw = calls[0]?.init.body;
  if (typeof raw !== 'string') throw new Error('No request body was sent');
  return { body: JSON.parse(raw) as Record<string, unknown>, raw };
}

const withThinking = (
  level: Level,
  info: ModelInfo | undefined,
  patch: Partial<LlmRequest> = {},
): LlmRequest => ({ ...REQUEST, ...patch, thinking: { level, info } });

/** The body the same request produces without thinking information. */
async function plain(
  kind: ProviderKind,
  patch: Partial<LlmRequest> = {},
  baseUrl?: string,
): Promise<Sent> {
  return send(kind, { ...REQUEST, ...patch }, baseUrl);
}

const MESSAGES = [
  { role: 'user', content: 'First question' },
  { role: 'assistant', content: 'First answer' },
  { role: 'user', content: 'Second question' },
];

describe('Anthropic thinking mapping', () => {
  const EFFORT: ModelInfo = {
    thinking: 'supported',
    thinkingMode: 'effort',
    maxOutputTokens: 64000,
  };
  const BUDGET: ModelInfo = {
    thinking: 'supported',
    thinkingMode: 'budget',
    maxOutputTokens: 64000,
  };
  const UNSUPPORTED: ModelInfo = { thinking: 'unsupported', maxOutputTokens: 64000 };
  const ADAPTIVE = { type: 'adaptive', display: 'summarized' };

  const base = (maxTokens: number) => ({
    model: 'test-model',
    max_tokens: maxTokens,
    system: 'Answer from the pages.',
    messages: MESSAGES,
    stream: true,
  });

  interface Row {
    name: string;
    info: ModelInfo | undefined;
    level: Level;
    /** `null`: exactly the body without thinking information. */
    sent: { max_tokens: number; thinking: unknown; output_config?: unknown } | null;
  }

  const ROWS: Row[] = [
    {
      name: 'effort mode, Default',
      info: EFFORT,
      level: null,
      sent: { max_tokens: 32000, thinking: ADAPTIVE },
    },
    ...LEVELS.map((level): Row => ({
      name: `effort mode, ${level}`,
      info: EFFORT,
      level,
      sent: { max_tokens: 32000, thinking: ADAPTIVE, output_config: { effort: level } },
    })),
    { name: 'budget mode, Default', info: BUDGET, level: null, sent: null },
    ...(
      [
        ['low', 2048],
        ['medium', 8192],
        ['high', 16384],
      ] as const
    ).map(([level, budget]): Row => ({
      name: `budget mode, ${level}`,
      info: BUDGET,
      level,
      sent: { max_tokens: 32000, thinking: { type: 'enabled', budget_tokens: budget } },
    })),
    { name: 'unknown, Default', info: undefined, level: null, sent: null },
    ...LEVELS.map((level): Row => ({
      name: `unknown, ${level}`,
      info: undefined,
      level,
      sent: { max_tokens: 32000, thinking: ADAPTIVE, output_config: { effort: level } },
    })),
    // Not in the spec's table: the control is hidden for these models (decisions.md T13).
    { name: 'unsupported, Default', info: UNSUPPORTED, level: null, sent: null },
    { name: 'unsupported, high', info: UNSUPPORTED, level: 'high', sent: null },
    // Supported without a mode can only come from damaged stored data: as unknown.
    {
      name: 'supported without a mode, Default',
      info: { thinking: 'supported' },
      level: null,
      sent: null,
    },
    {
      name: 'supported without a mode, low',
      info: { thinking: 'supported' },
      level: 'low',
      sent: { max_tokens: 32000, thinking: ADAPTIVE, output_config: { effort: 'low' } },
    },
  ];

  it.each(ROWS)('$name', async (row) => {
    const { body, raw } = await send('anthropic', withThinking(row.level, row.info));
    if (row.sent === null) {
      expect(raw).toBe((await plain('anthropic')).raw);
      expect(body).toEqual(base(ANTHROPIC_DEFAULT_MAX_TOKENS));
    } else {
      expect(body).toEqual({ ...base(row.sent.max_tokens), ...row.sent });
    }
    for (const key of ['temperature', 'top_p', 'top_k']) expect(body).not.toHaveProperty(key);
    expect(raw).not.toContain('disabled');
  });

  it('keeps the history text only', async () => {
    const { body } = await send('anthropic', withThinking('high', EFFORT));
    expect(body.messages).toEqual(MESSAGES);
  });

  describe('max_tokens', () => {
    const effort = (maxOutputTokens?: number): ModelInfo => ({
      thinking: 'supported',
      thinkingMode: 'effort',
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    });

    it.each([
      ['a known cap below 32000', effort(8192), 8192],
      ['a known cap of exactly 32000', effort(32000), 32000],
      ['a known cap above 32000', effort(128000), 32000],
      ['an unknown cap', effort(), 32000],
      ['an unknown model', undefined, 32000],
    ])('is set for %s', async (_label, info, expected) => {
      const { body } = await send('anthropic', withThinking('high', info));
      expect(body.max_tokens).toBe(expected);
      expect(body.thinking).toEqual(ADAPTIVE);
    });

    it('lowers to the cap at Default too, in effort mode', async () => {
      const { body } = await send('anthropic', withThinking(null, effort(8192)));
      expect(body).toMatchObject({ max_tokens: 8192, thinking: ADAPTIVE });
      expect(body).not.toHaveProperty('output_config');
    });

    it("keeps the caller's maxOutputTokens, whatever the cap", async () => {
      for (const info of [effort(8192), effort(128000), undefined]) {
        const { body } = await send(
          'anthropic',
          withThinking('medium', info, { maxOutputTokens: 50000 }),
        );
        expect(body).toMatchObject({
          max_tokens: 50000,
          thinking: ADAPTIVE,
          output_config: { effort: 'medium' },
        });
      }
    });

    it("keeps today's value when no thinking parameter is sent", async () => {
      const cases: [Level, ModelInfo | undefined][] = [
        [null, { thinking: 'supported', thinkingMode: 'budget', maxOutputTokens: 2000 }],
        [null, undefined],
        ['high', { thinking: 'unsupported', maxOutputTokens: 2000 }],
      ];
      for (const [level, info] of cases) {
        expect((await send('anthropic', withThinking(level, info))).body.max_tokens).toBe(4096);
        const limited = await send('anthropic', withThinking(level, info, { maxOutputTokens: 7 }));
        expect(limited.body.max_tokens).toBe(7);
      }
    });
  });

  describe('budget against max_tokens', () => {
    const budget = (maxOutputTokens?: number): ModelInfo => ({
      thinking: 'supported',
      thinkingMode: 'budget',
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    });

    interface BudgetRow {
      name: string;
      level: ThinkingLevel;
      cap?: number;
      maxOutputTokens?: number;
      max_tokens: number;
      /** `null`: no `thinking` parameter is sent. */
      budget_tokens: number | null;
    }

    const BUDGET_ROWS: BudgetRow[] = [
      { name: 'unknown cap', level: 'high', max_tokens: 32000, budget_tokens: 16384 },
      {
        name: 'cap above the budget',
        level: 'high',
        cap: 16385,
        max_tokens: 16385,
        budget_tokens: 16384,
      },
      {
        name: 'cap equal to the budget',
        level: 'high',
        cap: 16384,
        max_tokens: 16384,
        budget_tokens: 15360,
      },
      {
        name: 'cap below the budget',
        level: 'high',
        cap: 8192,
        max_tokens: 8192,
        budget_tokens: 7168,
      },
      {
        name: 'cap equal to the medium budget',
        level: 'medium',
        cap: 8192,
        max_tokens: 8192,
        budget_tokens: 7168,
      },
      {
        name: 'cap that leaves low alone',
        level: 'low',
        cap: 8192,
        max_tokens: 8192,
        budget_tokens: 2048,
      },
      {
        name: 'cap that leaves exactly 1024',
        level: 'low',
        cap: 2048,
        max_tokens: 2048,
        budget_tokens: 1024,
      },
      {
        name: 'cap that leaves 1023',
        level: 'low',
        cap: 2047,
        max_tokens: 4096,
        budget_tokens: null,
      },
      { name: 'a tiny cap', level: 'high', cap: 1000, max_tokens: 4096, budget_tokens: null },
      {
        name: "the caller's limit below the budget",
        level: 'high',
        cap: 64000,
        maxOutputTokens: 10000,
        max_tokens: 10000,
        budget_tokens: 8976,
      },
      {
        name: "the caller's limit above the budget",
        level: 'medium',
        cap: 4096,
        maxOutputTokens: 20000,
        max_tokens: 20000,
        budget_tokens: 8192,
      },
      {
        name: "the caller's limit too small for any budget",
        level: 'low',
        cap: 64000,
        maxOutputTokens: 1,
        max_tokens: 1,
        budget_tokens: null,
      },
    ];

    it.each(BUDGET_ROWS)('$name ($level)', async (row) => {
      const patch =
        row.maxOutputTokens !== undefined ? { maxOutputTokens: row.maxOutputTokens } : {};
      const { body, raw } = await send(
        'anthropic',
        withThinking(row.level, budget(row.cap), patch),
      );
      expect(body.max_tokens).toBe(row.max_tokens);
      if (row.budget_tokens === null) {
        expect(raw).toBe((await plain('anthropic', patch)).raw);
      } else {
        expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: row.budget_tokens });
        expect(row.budget_tokens).toBeLessThan(row.max_tokens);
      }
      expect(body).not.toHaveProperty('output_config');
    });
  });
});

describe('Gemini thinking mapping', () => {
  const SUPPORTED: ModelInfo = { thinking: 'supported' };
  const UNSUPPORTED: ModelInfo = { thinking: 'unsupported' };
  const BUDGETS = { low: 2048, medium: 8192, high: 24576 } as const;

  interface Row {
    name: string;
    model: string;
    info: ModelInfo | undefined;
    level: Level;
    /** `null`: exactly the body without thinking information. */
    thinkingConfig: Record<string, unknown> | null;
  }

  const ROWS: Row[] = [
    {
      name: 'supported, Default',
      model: 'gemini-3-pro',
      info: SUPPORTED,
      level: null,
      thinkingConfig: { includeThoughts: true },
    },
    {
      name: 'unknown, Default',
      model: 'gemini-3-pro',
      info: undefined,
      level: null,
      thinkingConfig: null,
    },
    ...LEVELS.flatMap((level): Row[] => [
      {
        name: `supported, ${level}`,
        model: 'gemini-3-pro',
        info: SUPPORTED,
        level,
        thinkingConfig: { includeThoughts: true, thinkingLevel: level },
      },
      {
        name: `unknown, ${level}`,
        model: 'gemini-3-pro',
        info: undefined,
        level,
        thinkingConfig: { includeThoughts: true, thinkingLevel: level },
      },
      {
        name: `gemini-2.5, supported, ${level}`,
        model: 'gemini-2.5-flash',
        info: SUPPORTED,
        level,
        thinkingConfig: { includeThoughts: true, thinkingBudget: BUDGETS[level] },
      },
      {
        name: `gemini-2.5 with the models/ prefix, unknown, ${level}`,
        model: 'models/gemini-2.5-pro-preview',
        info: undefined,
        level,
        thinkingConfig: { includeThoughts: true, thinkingBudget: BUDGETS[level] },
      },
    ]),
    {
      name: 'gemini-2.5, supported, Default',
      model: 'gemini-2.5-flash',
      info: SUPPORTED,
      level: null,
      thinkingConfig: { includeThoughts: true },
    },
    // Not in the spec's table: the control is hidden for these models (decisions.md T13).
    {
      name: 'unsupported, Default',
      model: 'gemini-3-pro',
      info: UNSUPPORTED,
      level: null,
      thinkingConfig: null,
    },
    {
      name: 'unsupported, high',
      model: 'gemini-2.5-flash',
      info: UNSUPPORTED,
      level: 'high',
      thinkingConfig: null,
    },
  ];

  it.each(ROWS)('$name', async (row) => {
    const patch = { model: row.model };
    const { body, raw } = await send('gemini', withThinking(row.level, row.info, patch));
    const without = await plain('gemini', patch);
    if (row.thinkingConfig === null) {
      expect(raw).toBe(without.raw);
      expect(body).not.toHaveProperty('generationConfig');
    } else {
      expect(body).toEqual({
        ...without.body,
        generationConfig: { thinkingConfig: row.thinkingConfig },
      });
      expect(
        Object.keys(row.thinkingConfig).filter((key) => key !== 'includeThoughts').length,
      ).toBeLessThan(2);
    }
  });

  it('keeps maxOutputTokens next to the thinking config', async () => {
    const { body } = await send('gemini', withThinking('low', SUPPORTED, { maxOutputTokens: 900 }));
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 900,
      thinkingConfig: { includeThoughts: true, thinkingLevel: 'low' },
    });
  });
});

describe('OpenAI-compatible thinking mapping', () => {
  const SUPPORTED: ModelInfo = { thinking: 'supported' };
  const UNSUPPORTED: ModelInfo = { thinking: 'unsupported' };
  const HOSTS = [
    'https://api.openai.com/v1',
    'https://openrouter.ai/api/v1',
    'https://api.groq.com/openai/v1',
    'http://localhost:11434/v1',
  ];

  interface Row {
    name: string;
    info: ModelInfo | undefined;
    level: Level;
    /** `null`: exactly the body without thinking information. */
    reasoning_effort: string | null;
  }

  const ROWS: Row[] = [
    { name: 'unknown, Default', info: undefined, level: null, reasoning_effort: null },
    { name: 'supported, Default', info: SUPPORTED, level: null, reasoning_effort: null },
    ...LEVELS.flatMap((level): Row[] => [
      { name: `unknown, ${level}`, info: undefined, level, reasoning_effort: level },
      { name: `supported, ${level}`, info: SUPPORTED, level, reasoning_effort: level },
    ]),
    // Not in the spec's rules: the control is hidden for these models (decisions.md T13).
    { name: 'unsupported, Default', info: UNSUPPORTED, level: null, reasoning_effort: null },
    { name: 'unsupported, high', info: UNSUPPORTED, level: 'high', reasoning_effort: null },
  ];

  describe.each(HOSTS)('on %s', (baseUrl) => {
    it.each(ROWS)('$name', async (row) => {
      const { body, raw } = await send(
        'openai-compatible',
        withThinking(row.level, row.info),
        baseUrl,
      );
      const without = await plain('openai-compatible', {}, baseUrl);
      if (row.reasoning_effort === null) expect(raw).toBe(without.raw);
      else expect(body).toEqual({ ...without.body, reasoning_effort: row.reasoning_effort });
    });
  });

  it('keeps the output limit next to the level', async () => {
    const { body } = await send(
      'openai-compatible',
      withThinking('medium', undefined, { maxOutputTokens: 900 }),
    );
    expect(body).toMatchObject({ max_completion_tokens: 900, reasoning_effort: 'medium' });
  });
});

describe('thinking-unsupported', () => {
  const REJECTIONS = [
    "Unsupported parameter: 'reasoning_effort' is not supported with this model.",
    'Reasoning is not available for this model',
    'thinking: adaptive thinking is not supported on this model',
    'Thinking level is not supported for this model.',
    'This model does not support the effort parameter.',
    'output_config.effort: Extra inputs are not permitted',
  ];
  const body = (message: string) => JSON.stringify({ error: { message } });

  describe('errorFromResponse', () => {
    it.each(REJECTIONS)('maps a 400 and a 422 saying "%s" on a request with a level', (message) => {
      for (const status of [400, 422]) {
        const error = errorFromResponse(status, body(message), KEY, { thinkingLevel: true });
        expect(error.code).toBe('thinking-unsupported');
        expect(error.status).toBe(status);
        expect(error.message).toBe('LLM request failed: thinking-unsupported');
      }
    });

    it.each(REJECTIONS)('maps the same 400 saying "%s" as before without a level', (message) => {
      for (const facts of [undefined, {}, { thinkingLevel: false }]) {
        const error = errorFromResponse(400, body(message), KEY, facts);
        expect(error.code).toBe('bad-request');
        expect(error.providerMessage).toBe(message);
      }
    });

    it('reads plain-text and `detail` bodies', () => {
      const facts = { thinkingLevel: true };
      expect(errorFromResponse(400, 'unknown field reasoning_effort', KEY, facts).code).toBe(
        'thinking-unsupported',
      );
      expect(
        errorFromResponse(422, '{"detail":"Extra field: reasoning_effort"}', KEY, facts).code,
      ).toBe('thinking-unsupported');
    });

    it('leaves a 400 about something else as it was', () => {
      const error = errorFromResponse(400, body('temperature must be at most 2'), KEY, {
        thinkingLevel: true,
      });
      expect(error.code).toBe('bad-request');
    });

    it('matches the message only, not the error type or code', () => {
      const tagged = JSON.stringify({
        error: { message: 'Bad value', type: 'reasoning_error', code: 'effort_invalid' },
      });
      expect(errorFromResponse(400, tagged, KEY, { thinkingLevel: true }).code).toBe('bad-request');
      expect(errorFromResponse(400, '', KEY, { thinkingLevel: true }).code).toBe('bad-request');
    });

    it.each([
      [401, 'invalid-key'],
      [403, 'invalid-key'],
      [404, 'model-not-found'],
      [409, 'bad-request'],
      [413, 'context-too-long'],
      [429, 'rate-limit'],
      [500, 'server'],
    ] as const)('maps status %i as before, whatever the message says', (status, code) => {
      const error = errorFromResponse(status, body('thinking effort reasoning'), KEY, {
        thinkingLevel: true,
      });
      expect(error.code).toBe(code);
    });

    it('lets the more specific 400 readings win, as before', () => {
      const facts = { thinkingLevel: true };
      const cases = [
        ['The model `o9-thinking` does not exist', 'model-not-found'],
        ['API key not valid for reasoning models', 'invalid-key'],
        ['prompt is too long for extended thinking', 'context-too-long'],
      ] as const;
      for (const [message, code] of cases) {
        expect(errorFromResponse(400, body(message), KEY, facts).code).toBe(code);
      }
    });
  });

  describe('per adapter', () => {
    interface Case {
      kind: ProviderKind;
      errorBody: (message: string) => unknown;
      /** Model info for which a level is sent. */
      info: ModelInfo | undefined;
    }
    const CASES: Case[] = [
      {
        kind: 'openai-compatible',
        errorBody: (message) => ({ error: { message, type: 'invalid_request_error' } }),
        info: undefined,
      },
      {
        kind: 'anthropic',
        errorBody: (message) => ({
          type: 'error',
          error: { type: 'invalid_request_error', message },
        }),
        info: { thinking: 'supported', thinkingMode: 'budget' },
      },
      {
        kind: 'gemini',
        errorBody: (message) => ({ error: { code: 400, message, status: 'INVALID_ARGUMENT' } }),
        info: { thinking: 'supported' },
      },
    ];
    const MESSAGE = 'Thinking is not supported by this model.';

    async function codeFor(c: Case, request: LlmRequest, status = 400, message = MESSAGE) {
      const { fetch } = mockFetch(() => jsonResponse(status, c.errorBody(message)));
      const provider = createProvider(
        { kind: c.kind, baseUrl: DEFAULT_BASE_URLS[c.kind], apiKey: KEY },
        { fetch },
      );
      return (await collect(provider, request)).error?.code;
    }

    describe.each(CASES)('$kind', (c) => {
      it.each(LEVELS)('maps the rejection of level %s', async (level) => {
        expect(await codeFor(c, withThinking(level, c.info))).toBe('thinking-unsupported');
        expect(await codeFor(c, withThinking(level, c.info), 422)).toBe('thinking-unsupported');
      });

      it('maps the same 400 as before without thinking information', async () => {
        expect(await codeFor(c, REQUEST)).toBe('bad-request');
      });

      it('maps the same 400 as before at Default', async () => {
        expect(await codeFor(c, withThinking(null, c.info))).toBe('bad-request');
        expect(await codeFor(c, withThinking(null, undefined))).toBe('bad-request');
      });

      it('maps the same 400 as before when no level was sent for an unsupported model', async () => {
        expect(await codeFor(c, withThinking('high', { thinking: 'unsupported' }))).toBe(
          'bad-request',
        );
      });

      it('maps other failures of a request with a level as before', async () => {
        const request = withThinking('high', c.info);
        expect(await codeFor(c, request, 400, 'temperature must be at most 2')).toBe('bad-request');
        expect(await codeFor(c, request, 429)).toBe('rate-limit');
        expect(await codeFor(c, request, 500)).toBe('server');
      });
    });

    it('Anthropic: thinking sent at Default carries no level, so the 400 maps as before', async () => {
      const anthropic = CASES[1] as Case;
      const info: ModelInfo = { thinking: 'supported', thinkingMode: 'effort' };
      expect(await codeFor(anthropic, withThinking(null, info))).toBe('bad-request');
    });

    it('Anthropic: a budget dropped by a small cap carries no level, so the 400 maps as before', async () => {
      const anthropic = CASES[1] as Case;
      const info: ModelInfo = {
        thinking: 'supported',
        thinkingMode: 'budget',
        maxOutputTokens: 1500,
      };
      expect(await codeFor(anthropic, withThinking('low', info))).toBe('bad-request');
    });

    it('model listing never maps to it', async () => {
      for (const c of CASES) {
        const { fetch } = mockFetch(() => jsonResponse(400, c.errorBody(MESSAGE)));
        const provider = createProvider(
          { kind: c.kind, baseUrl: DEFAULT_BASE_URLS[c.kind], apiKey: KEY },
          { fetch },
        );
        expect(await provider.listModels()).toMatchObject({
          models: null,
          error: { code: 'bad-request' },
        });
      }
    });
  });
});
