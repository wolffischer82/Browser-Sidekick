// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createProvider, LlmError, type LlmRequest } from '../src/shared/llm';
import { MOCK_MODELS, MOCK_REPLY, startMockLlm, type MockLlm } from './mock-llm/server';

// The mock server against the real OpenAI-compatible adapter, over loopback
// only. Later tasks reuse the server; this pins its behaviour.

const KEY = 'sk-mock-valid-1234';
const REQUEST: LlmRequest = {
  model: 'mock-large',
  system: 'Be brief.',
  turns: [{ role: 'user', content: 'Hello' }],
};

let mock: MockLlm;

beforeAll(async () => {
  mock = await startMockLlm({ apiKey: KEY });
});
afterAll(async () => {
  await mock.close();
});
afterEach(() => {
  mock.reset();
  mock.setApiKey(KEY);
  mock.setModels(MOCK_MODELS);
});

const loopbackFetch = (input: string, init: RequestInit) => fetch(input, init);

function provider(apiKey = KEY) {
  return createProvider(
    { kind: 'openai-compatible', baseUrl: mock.baseUrl, apiKey },
    { fetch: loopbackFetch },
  );
}

async function collect(apiKey = KEY, request = REQUEST, signal = new AbortController().signal) {
  let text = '';
  for await (const event of provider(apiKey).stream(request, signal)) {
    if (event.type === 'text') text += event.delta;
  }
  return text;
}

async function failure(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LlmError) return error;
    throw error;
  }
  throw new Error('Expected an LlmError');
}

describe('mock OpenAI-compatible server', () => {
  it('lists models', async () => {
    expect(await provider().listModels()).toEqual({
      models: [...MOCK_MODELS].sort(),
      info: {},
    });
    expect(mock.requests[0]).toMatchObject({ method: 'GET', path: '/v1/models' });
  });

  it('answers 404 on /v1/models when listing is switched off, so the form falls back', async () => {
    mock.setModels(null);
    const list = await provider().listModels();
    expect(list.models).toBeNull();
  });

  it('streams the default reply and records the request', async () => {
    expect(await collect()).toBe(MOCK_REPLY);
    const [request] = mock.requests;
    expect(request?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(request?.body).toMatchObject({
      model: 'mock-large',
      stream: true,
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hello' },
      ],
    });
  });

  it('rejects a wrong key with 401 on both endpoints', async () => {
    expect((await failure(collect('sk-wrong'))).code).toBe('invalid-key');
    const list = await provider('sk-wrong').listModels();
    expect(list.models).toBeNull();
  });

  it('accepts any key, or none, when no key is required', async () => {
    mock.setApiKey(undefined);
    expect(await collect('')).toBe(MOCK_REPLY);
    expect(mock.requests[0]?.headers.authorization).toBeUndefined();
  });

  it('answers 404 for an unknown model', async () => {
    const error = await failure(collect(KEY, { ...REQUEST, model: 'nope' }));
    expect(error.code).toBe('model-not-found');
  });

  it('plays scripted replies in order, then the default again', async () => {
    mock.script(
      { kind: 'error', status: 429, body: { error: { message: 'Slow down.' } } },
      {
        kind: 'error',
        status: 400,
        body: { error: { message: 'maximum context length is 8192 tokens' } },
      },
      { kind: 'stream', chunks: ['One ', 'two'] },
    );
    expect((await failure(collect())).code).toBe('rate-limit');
    expect((await failure(collect())).code).toBe('context-too-long');
    expect(await collect()).toBe('One two');
    expect(await collect()).toBe(MOCK_REPLY);
  });

  it('keeps a hanging stream open until the client aborts', async () => {
    mock.script({ kind: 'stream', chunks: ['Partial'], hang: true });
    const controller = new AbortController();
    let text = '';
    const error = await failure(
      (async () => {
        for await (const event of provider().stream(REQUEST, controller.signal)) {
          text += event.delta;
          controller.abort();
        }
      })(),
    );
    expect(error.code).toBe('aborted');
    expect(text).toBe('Partial');
  });

  it('answers CORS preflights for extension pages without host access', async () => {
    const response = await fetch(`${mock.baseUrl}/chat/completions`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
  });
});
