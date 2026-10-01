// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createProvider, LlmError, type LlmRequest, type LlmStreamEvent } from '../src/shared/llm';
import {
  MOCK_MODELS,
  MOCK_PLAIN_MODEL,
  MOCK_REJECTING_MODEL,
  MOCK_REJECTION,
  MOCK_REPLY,
  MOCK_THINKING_MODEL,
  MOCK_THINKING_MODELS,
  startMockLlm,
  type MockLlm,
} from './mock-llm/server';

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

async function collectEvents() {
  const events: LlmStreamEvent[] = [];
  for await (const event of provider().stream(REQUEST, new AbortController().signal)) {
    events.push(event);
  }
  return events;
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

  it('sends no reasoning unless a scripted reply asks for it', async () => {
    const events = await collectEvents();
    expect(events.every((e) => e.type === 'text')).toBe(true);
    expect(events.map((e) => e.delta).join('')).toBe(MOCK_REPLY);
    mock.script({ kind: 'stream', chunks: ['One ', 'two'] });
    expect(await collectEvents()).toEqual([
      { type: 'text', delta: 'One ' },
      { type: 'text', delta: 'two' },
    ]);
  });

  it.each([
    [undefined, 'reasoning_content'],
    ['reasoning_content', 'reasoning_content'],
    ['reasoning', 'reasoning'],
  ] as const)(
    'streams scripted reasoning before the answer (reasoningField %s)',
    async (reasoningField, field) => {
      mock.script({
        kind: 'stream',
        reasoning: ['Let me ', 'think.'],
        chunks: ['The ', 'answer.'],
        ...(reasoningField ? { reasoningField } : {}),
      });
      // What goes over the wire: the reasoning chunks under the chosen field name.
      const response = await fetch(`${mock.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: 'mock-large', messages: [], stream: true }),
      });
      const deltas = (await response.text())
        .split('\n\n')
        .filter((line) => line.startsWith('data: {'))
        .map(
          (line) =>
            (JSON.parse(line.slice(6)) as { choices: { delta: Record<string, unknown> }[] })
              .choices[0]?.delta,
        );
      expect(deltas).toEqual([
        { role: 'assistant', content: '' },
        { [field]: 'Let me ' },
        { [field]: 'think.' },
        { content: 'The ' },
        { content: 'answer.' },
        {},
      ]);

      // And through the adapter: reasoning events, then text events.
      mock.script({
        kind: 'stream',
        reasoning: ['Let me ', 'think.'],
        chunks: ['The ', 'answer.'],
        ...(reasoningField ? { reasoningField } : {}),
      });
      expect(await collectEvents()).toEqual([
        { type: 'reasoning', delta: 'Let me ' },
        { type: 'reasoning', delta: 'think.' },
        { type: 'text', delta: 'The ' },
        { type: 'text', delta: 'answer.' },
      ]);
      // The next reply is the plain default again.
      expect((await collectEvents()).every((e) => e.type === 'text')).toBe(true);
    },
  );

  it('holds a scripted stream at the given chunks until it is released', async () => {
    mock.script({
      kind: 'stream',
      reasoning: ['Let me ', 'think.'],
      chunks: ['The ', 'answer.'],
      holdAt: [1, 2],
    });
    const events: LlmStreamEvent[] = [];
    const done = (async () => {
      for await (const event of provider().stream(REQUEST, new AbortController().signal)) {
        events.push(event);
      }
    })();
    const settled = () => new Promise((resolve) => setTimeout(resolve, 60));
    await expect.poll(() => events.length).toBe(1);
    // A release lets the stream run to its next hold, not further.
    await settled();
    expect(events).toEqual([{ type: 'reasoning', delta: 'Let me ' }]);
    mock.release();
    await expect.poll(() => events.length).toBe(2);
    await settled();
    expect(events.at(-1)).toEqual({ type: 'reasoning', delta: 'think.' });
    mock.release();
    await done;
    expect(events.slice(2)).toEqual([
      { type: 'text', delta: 'The ' },
      { type: 'text', delta: 'answer.' },
    ]);
    // Nothing is held any more; a release without a held stream does nothing.
    mock.release();
    expect(await collect()).toBe(MOCK_REPLY);
  });

  it('a held stream ends when the client goes away', async () => {
    mock.script({ kind: 'stream', reasoning: ['Thinking'], chunks: ['Never sent'], holdAt: [1] });
    const controller = new AbortController();
    const events: LlmStreamEvent[] = [];
    const done = (async () => {
      for await (const event of provider().stream(REQUEST, controller.signal)) events.push(event);
    })();
    await expect.poll(() => events.length).toBe(1);
    controller.abort();
    expect((await failure(done)).code).toBe('aborted');
    expect(events).toEqual([{ type: 'reasoning', delta: 'Thinking' }]);
    expect(await collect()).toBe(MOCK_REPLY);
  });

  describe('thinking levels (specs/thinking-levels.md T15)', () => {
    const withLevel = (model: string, level: 'low' | 'medium' | 'high' | null): LlmRequest => ({
      ...REQUEST,
      model,
      thinking: { level, info: undefined },
    });

    it('lists supported_parameters only for the entries that have them', async () => {
      mock.setModels(MOCK_THINKING_MODELS);
      const response = await fetch(`${mock.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${KEY}` },
      });
      const list = (await response.json()) as { data: Record<string, unknown>[] };
      expect(list.data.map((m) => [m.id, m.supported_parameters])).toEqual([
        ['mock-large', undefined],
        [MOCK_THINKING_MODEL, ['max_tokens', 'reasoning', 'temperature']],
        [MOCK_PLAIN_MODEL, ['max_tokens', 'temperature']],
        [MOCK_REJECTING_MODEL, undefined],
      ]);
      expect(list.data.every((m) => 'supported_parameters' in m)).toBe(false);

      // Through the adapter: supported, unsupported, and no entry for the unknown ones.
      expect(await provider().listModels()).toEqual({
        models: ['mock-large', MOCK_REJECTING_MODEL, MOCK_PLAIN_MODEL, MOCK_THINKING_MODEL].sort(),
        info: {
          [MOCK_THINKING_MODEL]: { thinking: 'supported' },
          [MOCK_PLAIN_MODEL]: { thinking: 'unsupported' },
        },
      });
    });

    it('records the reasoning_effort of every completion request, and its absence', async () => {
      await collect(KEY, withLevel('mock-large', 'high'));
      await collect(KEY, withLevel('mock-large', null));
      await collect();
      await collect(KEY, withLevel('mock-small', 'low'));
      await provider().listModels();
      expect(mock.reasoningEfforts).toEqual(['high', undefined, undefined, 'low']);
      expect(mock.requests[0]?.body).toMatchObject({ reasoning_effort: 'high' });
      expect(mock.requests[1]?.body).not.toHaveProperty('reasoning_effort');
      mock.reset();
      expect(mock.reasoningEfforts).toEqual([]);
    });

    it('records the effort of a request it rejects for its key or its model', async () => {
      expect((await failure(collect('sk-wrong', withLevel('mock-large', 'medium')))).code).toBe(
        'invalid-key',
      );
      expect((await failure(collect(KEY, withLevel('nope', 'low')))).code).toBe('model-not-found');
      expect(mock.reasoningEfforts).toEqual(['medium', 'low']);
    });

    it('the rejecting model answers 400 naming reasoning_effort, and answers without one', async () => {
      mock.setModels(MOCK_THINKING_MODELS);
      mock.script({ kind: 'stream', chunks: ['Scripted.'] });
      const error = await failure(collect(KEY, withLevel(MOCK_REJECTING_MODEL, 'high')));
      expect(error.code).toBe('thinking-unsupported');
      expect(error.status).toBe(400);
      expect(error.providerMessage).toBe(MOCK_REJECTION);
      expect(MOCK_REJECTION).toContain('reasoning_effort');
      // The rejection didn't use up the scripted reply; Default gets it.
      expect(await collect(KEY, withLevel(MOCK_REJECTING_MODEL, null))).toBe('Scripted.');
      expect(await collect(KEY, { ...REQUEST, model: MOCK_REJECTING_MODEL })).toBe(MOCK_REPLY);
      expect(mock.reasoningEfforts).toEqual(['high', undefined, undefined]);
    });

    it('every other model accepts a reasoning_effort', async () => {
      mock.setModels(MOCK_THINKING_MODELS);
      for (const model of ['mock-large', MOCK_THINKING_MODEL]) {
        expect(await collect(KEY, withLevel(model, 'high'))).toBe(MOCK_REPLY);
      }
    });
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
