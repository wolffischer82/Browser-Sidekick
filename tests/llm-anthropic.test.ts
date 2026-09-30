// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ANTHROPIC_DEFAULT_MAX_TOKENS, createAnthropicProvider } from '../src/shared/llm/anthropic';
import {
  collect,
  guardGlobalFetch,
  jsonResponse,
  KEY,
  mockFetch,
  REQUEST,
  splitEvery,
  sseResponse,
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
  it('yields only text deltas, ignoring thinking, pings and unknown events, for any chunking', async () => {
    for (const size of [1, 2, 5, 64, STREAM.length]) {
      const { fetch } = mockFetch(() => sseResponse(splitEvery(STREAM, size)));
      const { deltas, error } = await collect(createAnthropicProvider({ apiKey: KEY }, fetch));
      expect(error).toBeNull();
      expect(deltas.join('')).toBe('Grüße, world [1].');
    }
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
    expect(result).toEqual({ models: ['claude-new', 'claude-mid', 'claude-old'] });
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
