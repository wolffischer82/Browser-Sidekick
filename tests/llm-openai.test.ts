// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createOpenAiProvider } from '../src/shared/llm/openai';
import {
  collect,
  collectEvents,
  guardGlobalFetch,
  jsonResponse,
  KEY,
  mockFetch,
  reasoning,
  REQUEST,
  splitEvery,
  sseResponse,
  text,
} from './helpers/llm-fetch';

guardGlobalFetch();

const chunk = (content: unknown, extra: Record<string, unknown> = {}): string =>
  `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content }, finish_reason: null }], ...extra })}\n\n`;

/** One chunk with the given `delta` object. */
const delta = (value: Record<string, unknown>): string =>
  `data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: value, finish_reason: null }] })}\n\n`;
const DONE = 'data: [DONE]\n\n';

describe('OpenAI-compatible request shape', () => {
  it('posts a streaming chat completion to <base>/chat/completions', async () => {
    const { fetch, calls } = mockFetch(() => sseResponse(['data: [DONE]\n\n']));
    await collect(
      createOpenAiProvider({ baseUrl: 'https://api.openai.com/v1/', apiKey: KEY }, fetch),
    );
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call?.init.method).toBe('POST');
    expect(call?.headers).toEqual({
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
    });
    expect(call?.body).toEqual({
      model: 'test-model',
      stream: true,
      messages: [
        { role: 'system', content: 'Answer from the pages.' },
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
      ],
    });
  });

  it('uses max_completion_tokens on api.openai.com and max_tokens elsewhere', async () => {
    const request = { ...REQUEST, maxOutputTokens: 1 };
    const official = mockFetch(() => sseResponse([]));
    await collect(
      createOpenAiProvider({ baseUrl: 'https://api.openai.com/v1', apiKey: KEY }, official.fetch),
      request,
    );
    expect(official.calls[0]?.body).toMatchObject({ max_completion_tokens: 1 });
    expect(official.calls[0]?.body).not.toHaveProperty('max_tokens');

    const local = mockFetch(() => sseResponse([]));
    await collect(
      createOpenAiProvider({ baseUrl: 'http://localhost:11434/v1', apiKey: '' }, local.fetch),
      request,
    );
    expect(local.calls[0]?.body).toMatchObject({ max_tokens: 1 });
  });

  it('omits the system message when empty and the auth header without a key', async () => {
    const { fetch, calls } = mockFetch(() => sseResponse([]));
    await collect(
      createOpenAiProvider({ baseUrl: 'http://localhost:1234/v1', apiKey: '' }, fetch),
      { ...REQUEST, system: '' },
    );
    expect(calls[0]?.url).toBe('http://localhost:1234/v1/chat/completions');
    expect(calls[0]?.headers).not.toHaveProperty('authorization');
    expect((calls[0]?.body as { messages: unknown[] }).messages).toHaveLength(3);
  });
});

describe('OpenAI-compatible stream parsing', () => {
  const provider = (respond: () => Response) =>
    createOpenAiProvider(
      { baseUrl: 'https://example.test/v1', apiKey: KEY },
      mockFetch(respond).fetch,
    );

  it('yields content deltas, skipping role-only, empty and null deltas, and stops at [DONE]', async () => {
    const text = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant' } }] })}\n\n`,
      chunk(''),
      chunk('Hello'),
      chunk(null),
      chunk(' world'),
      `data: ${JSON.stringify({ choices: [], usage: { total_tokens: 3 } })}\n\n`,
      'data: [DONE]\n\n',
      chunk('after done'),
    ].join('');
    for (const size of [1, 3, 17, text.length]) {
      const result = await collect(provider(() => sseResponse(splitEvery(text, size))));
      expect(result).toEqual({ deltas: ['Hello', ' world'], error: null });
    }
  });

  it('tolerates OpenRouter comments, CRLF, unknown fields and no [DONE]', async () => {
    const result = await collect(
      provider(() =>
        sseResponse([
          ': OPENROUTER PROCESSING\r\n\r\n',
          `data: ${JSON.stringify({ choices: [{ delta: { content: '', reasoning: 'thinking…' } }] })}\r\n\r\n`,
          `data:${JSON.stringify({ provider: 'x', choices: [{ delta: { content: 'A' }, native_finish_reason: null }] })}\r\n\r\n`,
          'event: custom\ndata: not json\n\n',
          chunk('B'),
        ]),
      ),
    );
    expect(result).toEqual({ deltas: ['A', 'B'], error: null });
  });

  it.each(['reasoning_content', 'reasoning'])(
    'yields `delta.%s` as reasoning, then the text, for any chunking',
    async (field) => {
      const stream = [
        delta({ role: 'assistant', content: '', [field]: '' }),
        delta({ [field]: 'Let me ' }),
        delta({ [field]: 'think.', content: null }),
        delta({ content: 'Hello' }),
        delta({ content: ' world' }),
        DONE,
      ].join('');
      for (const size of [1, 3, 17, stream.length]) {
        expect(await collectEvents(provider(() => sseResponse(splitEvery(stream, size))))).toEqual({
          events: [reasoning('Let me '), reasoning('think.'), text('Hello'), text(' world')],
          error: null,
        });
      }
    },
  );

  it('yields reasoning only when no text follows', async () => {
    const result = await collectEvents(
      provider(() =>
        sseResponse([delta({ reasoning: 'First, ' }), delta({ reasoning: 'the pages.' }), DONE]),
      ),
    );
    expect(result).toEqual({
      events: [reasoning('First, '), reasoning('the pages.')],
      error: null,
    });
  });

  it('keeps interleaved reasoning and text in arrival order, reasoning first within a chunk', async () => {
    const result = await collectEvents(
      provider(() =>
        sseResponse([
          delta({ reasoning_content: 'Plan. ' }),
          delta({ content: 'Part one. ' }),
          delta({ content: 'Part two.', reasoning_content: 'Check. ' }),
          delta({ reasoning: 'Done.' }),
          DONE,
        ]),
      ),
    );
    expect(result).toEqual({
      events: [
        reasoning('Plan. '),
        text('Part one. '),
        reasoning('Check. '),
        text('Part two.'),
        reasoning('Done.'),
      ],
      error: null,
    });
  });

  it('ignores reasoning that is not a non-empty string, and other reasoning shapes', async () => {
    const result = await collectEvents(
      provider(() =>
        sseResponse([
          delta({ reasoning: '' }),
          delta({ reasoning: null, reasoning_content: null }),
          delta({ reasoning: { text: 'nested' } }),
          delta({ reasoning_content: ['a', 'b'] }),
          delta({ reasoning: 42 }),
          delta({ reasoning_details: [{ type: 'reasoning.text', text: 'detail' }] }),
          delta({ thinking: 'other name' }),
          delta({ content: 'Answer.' }),
          DONE,
        ]),
      ),
    );
    expect(result).toEqual({ events: [text('Answer.')], error: null });
  });

  it('yields the reasoning once when a chunk carries both field names', async () => {
    const result = await collectEvents(
      provider(() =>
        sseResponse([
          delta({ reasoning_content: 'Same thought', reasoning: 'Same thought' }),
          DONE,
        ]),
      ),
    );
    expect(result.events).toEqual([reasoning('Same thought')]);
  });

  it('keeps the reasoning that arrived before an error chunk', async () => {
    const result = await collectEvents(
      provider(() =>
        sseResponse([
          delta({ reasoning: 'Half a thought' }),
          `data: ${JSON.stringify({ error: { code: 502, message: 'Upstream error' } })}\n\n`,
        ]),
      ),
    );
    expect(result.events).toEqual([reasoning('Half a thought')]);
    expect(result.error?.code).toBe('server');
  });

  it.each(['reasoning_content', 'reasoning'])(
    'yields `message.%s` of a non-streamed JSON completion before its text',
    async (field) => {
      const response = () =>
        jsonResponse(200, {
          choices: [
            { index: 0, message: { role: 'assistant', content: 'Whole answer', [field]: 'Why.' } },
          ],
        });
      expect(await collectEvents(provider(response))).toEqual({
        events: [reasoning('Why.'), text('Whole answer')],
        error: null,
      });
    },
  );

  it('accepts bare JSON lines without data: prefixes', async () => {
    const line = (content: string) => `${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;
    expect(
      await collect(provider(() => sseResponse([line('x'), line('y')], 'application/x-ndjson'))),
    ).toEqual({
      deltas: ['x', 'y'],
      error: null,
    });
  });

  it('accepts a non-streamed JSON completion', async () => {
    const response = () =>
      jsonResponse(200, {
        choices: [{ index: 0, message: { role: 'assistant', content: 'Whole answer' } }],
      });
    expect(await collect(provider(response))).toEqual({ deltas: ['Whole answer'], error: null });
  });

  it('maps an error object inside a non-streamed JSON reply', async () => {
    const response = () =>
      jsonResponse(200, { error: { message: 'Rate limit exceeded', code: 429 } });
    expect((await collect(provider(response))).error?.code).toBe('rate-limit');
  });

  it('maps an error chunk mid-stream and keeps earlier deltas', async () => {
    const result = await collect(
      provider(() =>
        sseResponse([
          chunk('Par'),
          `data: ${JSON.stringify({ error: { code: 502, message: 'Upstream error' } })}\n\n`,
        ]),
      ),
    );
    expect(result.deltas).toEqual(['Par']);
    expect(result.error).toMatchObject({ code: 'server', providerMessage: 'Upstream error' });
  });

  it('maps OpenAI and Ollama error bodies', async () => {
    const openAi = () =>
      jsonResponse(401, {
        error: {
          message: 'Incorrect API key provided',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      });
    expect((await collect(provider(openAi))).error?.code).toBe('invalid-key');
    const ollama = () =>
      jsonResponse(404, {
        error: { message: 'model "llama9" not found, try pulling it first', type: 'api_error' },
      });
    expect((await collect(provider(ollama))).error?.code).toBe('model-not-found');
  });
});

describe('OpenAI-compatible listModels', () => {
  it('lists /models ids, sorted and unique, with the auth header', async () => {
    const { fetch, calls } = mockFetch(() =>
      jsonResponse(200, {
        object: 'list',
        data: [
          { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
          { id: 'gpt-4.1-mini', object: 'model' },
          { id: 'gpt-4o', object: 'model' },
          { object: 'model' },
        ],
      }),
    );
    const result = await createOpenAiProvider(
      { baseUrl: 'https://api.openai.com/v1', apiKey: KEY },
      fetch,
    ).listModels();
    expect(result).toEqual({ models: ['gpt-4.1-mini', 'gpt-4o'], info: {} });
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/models');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.headers).toEqual({ authorization: `Bearer ${KEY}` });
  });

  it('accepts a `models` array with names (some gateways)', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(200, { models: [{ name: 'llama3.2' }, { name: 'qwen3' }] }),
    );
    const result = await createOpenAiProvider(
      { baseUrl: 'http://localhost:11434/v1', apiKey: '' },
      fetch,
    ).listModels();
    expect(result).toEqual({ models: ['llama3.2', 'qwen3'], info: {} });
  });

  it('falls back when the server has no /models (405)', async () => {
    const { fetch } = mockFetch(() => new Response('Method Not Allowed', { status: 405 }));
    const result = await createOpenAiProvider(
      { baseUrl: 'http://localhost:8080/v1', apiKey: '' },
      fetch,
    ).listModels();
    expect(result).toMatchObject({ models: null, error: { code: 'bad-request', status: 405 } });
  });
});
