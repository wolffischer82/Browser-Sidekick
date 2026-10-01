// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createGeminiProvider } from '../src/shared/llm/gemini';
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

const data = (value: unknown): string => `data: ${JSON.stringify(value)}\r\n\r\n`;
const parts = (...items: Record<string, unknown>[]): string =>
  data({
    candidates: [{ content: { role: 'model', parts: items }, index: 0 }],
    modelVersion: 'gemini-x',
  });

describe('Gemini request shape', () => {
  it('posts streamGenerateContent with alt=sse and the key in x-goog-api-key', async () => {
    const { fetch, calls } = mockFetch(() => sseResponse([]));
    await collect(createGeminiProvider({ apiKey: KEY }, fetch), { ...REQUEST, maxOutputTokens: 1 });
    const call = calls[0];
    expect(call?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/test-model:streamGenerateContent?alt=sse',
    );
    expect(call?.init.method).toBe('POST');
    expect(call?.headers).toEqual({ 'content-type': 'application/json', 'x-goog-api-key': KEY });
    expect(call?.body).toEqual({
      contents: [
        { role: 'user', parts: [{ text: 'First question' }] },
        { role: 'model', parts: [{ text: 'First answer' }] },
        { role: 'user', parts: [{ text: 'Second question' }] },
      ],
      systemInstruction: { parts: [{ text: 'Answer from the pages.' }] },
      generationConfig: { maxOutputTokens: 1 },
    });
  });

  it('accepts a models/ prefix, encodes the model id and omits optional fields', async () => {
    const { fetch, calls } = mockFetch(() => sseResponse([]));
    await collect(createGeminiProvider({ apiKey: KEY }, fetch), {
      ...REQUEST,
      model: 'models/tuned model',
      system: '',
    });
    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/tuned%20model:streamGenerateContent?alt=sse',
    );
    expect(calls[0]?.body).not.toHaveProperty('systemInstruction');
    expect(calls[0]?.body).not.toHaveProperty('generationConfig');
  });
});

describe('Gemini stream parsing', () => {
  it('yields part texts, skips thoughts and usage-only chunks, for any chunking', async () => {
    const text = [
      parts({ text: 'Thinking about it', thought: true }),
      parts({ text: 'Hallo ' }, { text: 'Welt' }),
      data({ usageMetadata: { promptTokenCount: 5 } }),
      parts({ text: ' [2].' }),
      data({
        candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP' }],
      }),
    ].join('');
    for (const size of [1, 4, 33, text.length]) {
      const { fetch } = mockFetch(() => sseResponse(splitEvery(text, size)));
      expect(await collect(createGeminiProvider({ apiKey: KEY }, fetch))).toEqual({
        deltas: ['Hallo Welt', ' [2].'],
        error: null,
      });
    }
  });

  it('maps an error object in the stream', async () => {
    const { fetch } = mockFetch(() =>
      sseResponse([
        parts({ text: 'a' }),
        data({ error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } }),
      ]),
    );
    expect(await collect(createGeminiProvider({ apiKey: KEY }, fetch))).toMatchObject({
      deltas: ['a'],
      error: { code: 'server', providerMessage: 'The model is overloaded.' },
    });
  });

  it('maps Gemini HTTP error bodies, including the API_KEY_INVALID 400', async () => {
    const cases = [
      [
        400,
        'INVALID_ARGUMENT',
        'API key not valid. Please pass a valid API key.',
        'API_KEY_INVALID',
        'invalid-key',
      ],
      [403, 'PERMISSION_DENIED', "Method doesn't allow unregistered callers.", null, 'invalid-key'],
      [
        429,
        'RESOURCE_EXHAUSTED',
        'Resource has been exhausted (e.g. check quota).',
        null,
        'rate-limit',
      ],
      [
        404,
        'NOT_FOUND',
        'models/gemini-nope is not found for API version v1beta.',
        null,
        'model-not-found',
      ],
      [
        400,
        'INVALID_ARGUMENT',
        'The input token count (2000000) exceeds the maximum number of tokens allowed (1048576).',
        null,
        'context-too-long',
      ],
      [500, 'INTERNAL', 'An internal error has occurred.', null, 'server'],
    ] as const;
    for (const [status, grpc, message, reason, code] of cases) {
      const body = {
        error: {
          code: status,
          message,
          status: grpc,
          ...(reason
            ? {
                details: [
                  {
                    '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                    reason,
                    domain: 'googleapis.com',
                  },
                ],
              }
            : {}),
        },
      };
      const { fetch } = mockFetch(() => jsonResponse(status, body));
      expect((await collect(createGeminiProvider({ apiKey: KEY }, fetch))).error?.code).toBe(code);
    }
  });
});

describe('Gemini listModels', () => {
  it('lists generateContent models across pages without the models/ prefix', async () => {
    const { fetch, calls } = mockFetch((call) =>
      call.url.includes('pageToken')
        ? jsonResponse(200, {
            models: [
              {
                name: 'models/gemini-b',
                supportedGenerationMethods: ['generateContent', 'countTokens'],
              },
            ],
          })
        : jsonResponse(200, {
            models: [
              {
                name: 'models/gemini-a',
                displayName: 'A',
                supportedGenerationMethods: ['generateContent'],
              },
              { name: 'models/text-embedding', supportedGenerationMethods: ['embedContent'] },
            ],
            nextPageToken: 'next page',
          }),
    );
    const result = await createGeminiProvider({ apiKey: KEY }, fetch).listModels();
    expect(result).toEqual({ models: ['gemini-a', 'gemini-b'], info: {} });
    expect(calls.map((c) => c.url)).toEqual([
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=next+page',
    ]);
    expect(calls[0]?.headers).toEqual({ 'x-goog-api-key': KEY });
  });

  it('falls back with invalid-key on the API_KEY_INVALID 400', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse(400, {
        error: {
          code: 400,
          message: 'API key not valid.',
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'API_KEY_INVALID' }],
        },
      }),
    );
    expect(await createGeminiProvider({ apiKey: KEY }, fetch).listModels()).toMatchObject({
      models: null,
      error: { code: 'invalid-key' },
    });
  });
});
