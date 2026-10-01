// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ANTHROPIC_DEFAULT_MAX_TOKENS, createAnthropicProvider } from '../src/shared/llm/anthropic';
import {
  collect,
  collectEvents,
  guardGlobalFetch,
  jsonResponse,
  KEY,
  merged,
  mockFetch,
  reasoning,
  REQUEST,
  splitEvery,
  sseResponse,
  text,
} from './helpers/llm-fetch';

guardGlobalFetch();

const event = (name: string, data: unknown): string =>
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const textDelta = (text: string): string =>
  event('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  });
const blockDelta = (index: number, delta: Record<string, unknown>): string =>
  event('content_block_delta', { type: 'content_block_delta', index, delta });
const thinkingDelta = (thinking: unknown, index = 0): string =>
  blockDelta(index, { type: 'thinking_delta', thinking });
const signatureDelta = (index = 0): string =>
  blockDelta(index, { type: 'signature_delta', signature: 'EqQBCgIYAhIM' });
const STOP = event('message_stop', { type: 'message_stop' });

/** A recorded-style stream per the Messages streaming docs. */
const STREAM = [
  event('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-x',
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  }),
  event('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: '' },
  }),
  event('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: 'Let me think' },
  }),
  event('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'signature_delta', signature: 'abc' },
  }),
  event('content_block_stop', { type: 'content_block_stop', index: 0 }),
  event('ping', { type: 'ping' }),
  event('content_block_start', {
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'text', text: '' },
  }),
  textDelta('Grüße, '),
  textDelta('world [1].'),
  event('some_future_event', { type: 'some_future_event', whatever: true }),
  event('content_block_stop', { type: 'content_block_stop', index: 1 }),
  event('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 15 },
  }),
  event('message_stop', { type: 'message_stop' }),
].join('');

describe('Anthropic request shape', () => {
  it('posts a streaming Messages request with the required headers', async () => {
    const { fetch, calls } = mockFetch(() => sseResponse([]));
    await collect(createAnthropicProvider({ apiKey: KEY }, fetch));
    const call = calls[0];
    expect(call?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call?.init.method).toBe('POST');
    expect(call?.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(call?.body).toEqual({
      model: 'test-model',
      max_tokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
      system: 'Answer from the pages.',
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
      ],
      stream: true,
    });
  });

  it('uses maxOutputTokens and omits an empty system prompt', async () => {
    const { fetch, calls } = mockFetch(() => sseResponse([]));
    await collect(createAnthropicProvider({ apiKey: KEY }, fetch), {
      ...REQUEST,
      system: '',
      maxOutputTokens: 1,
    });
    expect(calls[0]?.body).toMatchObject({ max_tokens: 1 });
    expect(calls[0]?.body).not.toHaveProperty('system');
  });
});

describe('Anthropic stream parsing', () => {
  const events = async (...chunks: string[]) =>
    collectEvents(
      createAnthropicProvider({ apiKey: KEY }, mockFetch(() => sseResponse(chunks)).fetch),
    );

  it('yields reasoning, then text, ignoring signatures, pings and unknown events, for any chunking', async () => {
    for (const size of [1, 2, 5, 64, STREAM.length]) {
      const { fetch } = mockFetch(() => sseResponse(splitEvery(STREAM, size)));
      const result = await collectEvents(createAnthropicProvider({ apiKey: KEY }, fetch));
      expect(result).toEqual({
        events: [reasoning('Let me think'), text('Grüße, '), text('world [1].')],
        error: null,
      });
    }
  });

  it('yields reasoning only when no text follows', async () => {
    expect(
      await events(thinkingDelta('First, '), thinkingDelta('the pages.'), signatureDelta(), STOP),
    ).toEqual({ events: [reasoning('First, '), reasoning('the pages.')], error: null });
  });

  it('keeps interleaved reasoning and text in arrival order', async () => {
    const result = await events(
      thinkingDelta('Plan. ', 0),
      signatureDelta(0),
      textDelta('Part one. '),
      thinkingDelta('Check. ', 2),
      thinkingDelta('Done.', 2),
      signatureDelta(2),
      textDelta('Part two.'),
      STOP,
    );
    expect(result.error).toBeNull();
    expect(result.events).toEqual([
      reasoning('Plan. '),
      text('Part one. '),
      reasoning('Check. '),
      reasoning('Done.'),
      text('Part two.'),
    ]);
    expect(merged(result.events)).toEqual([
      reasoning('Plan. '),
      text('Part one. '),
      reasoning('Check. Done.'),
      text('Part two.'),
    ]);
  });

  it('yields nothing for signatures, empty thinking and thinking that is not a string', async () => {
    const result = await events(
      event('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: 'not a delta' },
      }),
      thinkingDelta(''),
      thinkingDelta(null),
      thinkingDelta(42),
      thinkingDelta({ text: 'nested' }),
      blockDelta(0, { type: 'thinking_delta' }),
      signatureDelta(),
      blockDelta(0, { type: 'redacted_thinking_delta', data: 'opaque' }),
      textDelta('Answer.'),
      STOP,
    );
    expect(result).toEqual({ events: [text('Answer.')], error: null });
  });

  it('keeps the reasoning that arrived before an error event', async () => {
    const result = await events(
      thinkingDelta('Half a thought'),
      event('error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
    );
    expect(result.events).toEqual([reasoning('Half a thought')]);
    expect(result.error?.code).toBe('server');
  });

  it('stops at message_stop', async () => {
    const { fetch } = mockFetch(() =>
      sseResponse([
        textDelta('a'),
        event('message_stop', { type: 'message_stop' }),
        textDelta('b'),
      ]),
    );
    expect((await collect(createAnthropicProvider({ apiKey: KEY }, fetch))).deltas).toEqual(['a']);
  });

  it('maps an error event mid-stream and keeps earlier deltas', async () => {
    const { fetch } = mockFetch(() =>
      sseResponse([
        textDelta('Part'),
        event('error', {
          type: 'error',
          error: { type: 'overloaded_error', message: 'Overloaded' },
        }),
      ]),
    );
    const result = await collect(createAnthropicProvider({ apiKey: KEY }, fetch));
    expect(result.deltas).toEqual(['Part']);
    expect(result.error).toMatchObject({ code: 'server', providerMessage: 'Overloaded' });
  });

  it('maps Anthropic HTTP error bodies', async () => {
    const cases = [
      [401, 'authentication_error', 'invalid x-api-key', 'invalid-key'],
      [
        429,
        'rate_limit_error',
        'Number of request tokens has exceeded your rate limit',
        'rate-limit',
      ],
      [404, 'not_found_error', 'model: claude-nope', 'model-not-found'],
      [
        400,
        'invalid_request_error',
        'prompt is too long: 250000 tokens > 200000 maximum',
        'context-too-long',
      ],
      [529, 'overloaded_error', 'Overloaded', 'server'],
    ] as const;
    for (const [status, type, message, code] of cases) {
      const { fetch } = mockFetch(() =>
        jsonResponse(status, { type: 'error', error: { type, message }, request_id: 'req_1' }),
      );
      expect((await collect(createAnthropicProvider({ apiKey: KEY }, fetch))).error?.code).toBe(
        code,
      );
    }
  });
});

describe('Anthropic listModels', () => {
  it('lists models across pages with after_id', async () => {
    const { fetch, calls } = mockFetch((call) =>
      call.url.includes('after_id')
        ? jsonResponse(200, {
            data: [{ type: 'model', id: 'claude-old' }],
            has_more: false,
            first_id: 'claude-old',
            last_id: 'claude-old',
          })
        : jsonResponse(200, {
            data: [
              {
                type: 'model',
                id: 'claude-new',
                display_name: 'Claude New',
                created_at: '2026-01-01T00:00:00Z',
              },
              { type: 'model', id: 'claude-mid' },
            ],
            has_more: true,
            first_id: 'claude-new',
            last_id: 'claude-mid',
          }),
    );
    const result = await createAnthropicProvider({ apiKey: KEY }, fetch).listModels();
    expect(result).toEqual({ models: ['claude-new', 'claude-mid', 'claude-old'], info: {} });
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.anthropic.com/v1/models?limit=1000',
      'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-mid',
    ]);
    expect(calls[0]?.headers).toMatchObject({
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
    });
  });

  it('falls back with invalid-key on 401', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(401, {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      }),
    );
    expect(await createAnthropicProvider({ apiKey: KEY }, fetch).listModels()).toMatchObject({
      models: null,
      error: { code: 'invalid-key' },
    });
  });
});
