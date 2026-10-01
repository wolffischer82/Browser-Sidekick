// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createProvider, DEFAULT_BASE_URLS, LlmError, type FetchFn } from '../src/shared/llm';
import type { ProviderKind } from '../src/shared/model';
import {
  collect,
  controlledResponse,
  expectKeyOnlyIn,
  guardGlobalFetch,
  jsonResponse,
  KEY,
  mockFetch,
  REQUEST,
  sseResponse,
} from './helpers/llm-fetch';

/** Contract tests every adapter must pass: errors, abort, key placement, model-list fallback. */

guardGlobalFetch();

interface Case {
  kind: ProviderKind;
  keyHeader: string;
  /** One SSE event carrying `text` in the provider's format. */
  delta: (text: string) => string;
  modelList: unknown;
  errorBody: (message: string) => unknown;
}

const CASES: Case[] = [
  {
    kind: 'openai-compatible',
    keyHeader: 'authorization',
    delta: (text) =>
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`,
    modelList: { object: 'list', data: [{ id: 'gpt-b' }, { id: 'gpt-a' }] },
    errorBody: (message) => ({ error: { message, type: 'invalid_request_error' } }),
  },
  {
    kind: 'anthropic',
    keyHeader: 'x-api-key',
    delta: (text) =>
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`,
    modelList: { data: [{ type: 'model', id: 'claude-b' }], has_more: false, last_id: 'claude-b' },
    errorBody: (message) => ({ type: 'error', error: { type: 'invalid_request_error', message } }),
  },
  {
    kind: 'gemini',
    keyHeader: 'x-goog-api-key',
    delta: (text) =>
      `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] })}\n\n`,
    modelList: {
      models: [{ name: 'models/gemini-x', supportedGenerationMethods: ['generateContent'] }],
    },
    errorBody: (message) => ({ error: { code: 400, message, status: 'INVALID_ARGUMENT' } }),
  },
];

function provider(kind: ProviderKind, fetchFn?: FetchFn) {
  return createProvider(
    { kind, baseUrl: DEFAULT_BASE_URLS[kind], apiKey: KEY },
    fetchFn ? { fetch: fetchFn } : {},
  );
}

describe.each(CASES)('$kind adapter contract', (c) => {
  it('streams deltas', async () => {
    const { fetch } = mockFetch(() => sseResponse([c.delta('Hel'), c.delta('lo')]));
    expect(await collect(provider(c.kind, fetch))).toEqual({ deltas: ['Hel', 'lo'], error: null });
  });

  it.each([
    [401, 'invalid-key'],
    [403, 'invalid-key'],
    [429, 'rate-limit'],
    [404, 'model-not-found'],
    [500, 'server'],
  ] as const)('maps HTTP %i to %s', async (status, code) => {
    const { fetch } = mockFetch(() => jsonResponse(status, c.errorBody('nope')));
    const { error } = await collect(provider(c.kind, fetch));
    expect(error?.code).toBe(code);
    expect(error?.status).toBe(status);
  });

  it('maps a context-length 400 and keeps the provider message', async () => {
    const message = 'The request is too long for the context window';
    const { fetch } = mockFetch(() => jsonResponse(400, c.errorBody(message)));
    const { error } = await collect(provider(c.kind, fetch));
    expect(error?.code).toBe('context-too-long');
    expect(error?.providerMessage).toBe(message);
  });

  it('maps a failed fetch (network or CORS) to network', async () => {
    const fetch = vi.fn<FetchFn>(() => Promise.reject(new TypeError('Failed to fetch')));
    const { error } = await collect(provider(c.kind, fetch));
    expect(error?.code).toBe('network');
  });

  it('maps a stream that breaks mid-way to network and keeps the deltas', async () => {
    const encoder = new TextEncoder();
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++;
        if (reads === 1) controller.enqueue(encoder.encode(c.delta('part')));
        else controller.error(new TypeError('network error'));
      },
    });
    const { fetch } = mockFetch(
      () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    );
    expect(await collect(provider(c.kind, fetch))).toMatchObject({
      deltas: ['part'],
      error: { code: 'network' },
    });
  });

  it('aborts mid-stream, keeps the partial answer and cancels the body', async () => {
    const controlled = controlledResponse();
    const { fetch } = mockFetch(() => controlled.response);
    const abort = new AbortController();
    const deltas: string[] = [];
    let caught: unknown = null;
    controlled.push(c.delta('partial'));
    try {
      for await (const delta of provider(c.kind, fetch).stream(REQUEST, abort.signal)) {
        deltas.push(delta);
        abort.abort();
      }
    } catch (error) {
      caught = error;
    }
    expect(deltas).toEqual(['partial']);
    expect(caught).toBeInstanceOf(LlmError);
    expect((caught as LlmError).code).toBe('aborted');
    // The body was cancelled, so pushing more fails.
    expect(() => {
      controlled.push(c.delta('late'));
    }).toThrow();
  });

  it('aborts while waiting for the next chunk', async () => {
    const controlled = controlledResponse();
    const { fetch } = mockFetch(() => controlled.response);
    const abort = new AbortController();
    const pending = collect(provider(c.kind, fetch), REQUEST, abort.signal);
    controlled.push(c.delta('one'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    abort.abort();
    expect(await pending).toMatchObject({ deltas: ['one'], error: { code: 'aborted' } });
  });

  it('maps an abort while the request is pending, with any abort reason', async () => {
    const fetch = vi.fn<FetchFn>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
    const abort = new AbortController();
    const pending = collect(provider(c.kind, fetch), REQUEST, abort.signal);
    abort.abort(new Error('custom reason'));
    expect((await pending).error?.code).toBe('aborted');
  });

  it('does not call fetch when the signal is already aborted', async () => {
    const { fetch, calls } = mockFetch(() => sseResponse([]));
    const abort = new AbortController();
    abort.abort();
    expect((await collect(provider(c.kind, fetch), REQUEST, abort.signal)).error?.code).toBe(
      'aborted',
    );
    expect(calls).toHaveLength(0);
  });

  it('sends the key only in its own auth header', async () => {
    const { fetch, calls } = mockFetch((call) =>
      call.init.method === 'GET' ? jsonResponse(200, c.modelList) : sseResponse([c.delta('x')]),
    );
    const p = provider(c.kind, fetch);
    await collect(p);
    await p.listModels();
    expect(calls).toHaveLength(2);
    expectKeyOnlyIn(calls, c.keyHeader);
  });

  it('never puts the key into a mapped error', async () => {
    const { fetch } = mockFetch(() => jsonResponse(400, c.errorBody(`bad key ${KEY}`)));
    const { error } = await collect(provider(c.kind, fetch));
    expect(error?.providerMessage).not.toContain(KEY);
    expect(error?.message).not.toContain(KEY);
  });

  it('lists models', async () => {
    const { fetch } = mockFetch(() => jsonResponse(200, c.modelList));
    const result = await provider(c.kind, fetch).listModels();
    expect(result.models?.length).toBeGreaterThan(0);
  });

  it.each([
    ['404', () => jsonResponse(404, c.errorBody('not here'))],
    ['a non-JSON body', () => new Response('<html>hi</html>', { status: 200 })],
    ['an unexpected shape', () => jsonResponse(200, { unexpected: true })],
    ['an empty list', () => jsonResponse(200, { data: [], models: [] })],
  ])('falls back to free-text entry on %s', async (_label, respond) => {
    const { fetch } = mockFetch(respond);
    const result = await provider(c.kind, fetch).listModels();
    expect(result.models).toBeNull();
    expect('error' in result && result.error).toBeInstanceOf(LlmError);
  });

  it('falls back on a network failure and reports why', async () => {
    const fetch = vi.fn<FetchFn>(() => Promise.reject(new TypeError('Failed to fetch')));
    const result = await provider(c.kind, fetch).listModels();
    expect(result).toMatchObject({ models: null, error: { code: 'network' } });
  });

  it('rejects listModels with aborted when aborted', async () => {
    const { fetch } = mockFetch(() => jsonResponse(200, c.modelList));
    const abort = new AbortController();
    abort.abort();
    await expect(provider(c.kind, fetch).listModels(abort.signal)).rejects.toMatchObject({
      code: 'aborted',
    });
  });

  it('uses the global fetch by default', async () => {
    const stub = vi.fn(() => Promise.resolve(sseResponse([c.delta('g')])));
    vi.stubGlobal('fetch', stub);
    expect((await collect(provider(c.kind))).deltas).toEqual(['g']);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('mapError passes LlmError through and maps thrown values', () => {
    const p = provider(c.kind, vi.fn<FetchFn>());
    const existing = new LlmError('rate-limit');
    expect(p.mapError(existing)).toBe(existing);
    expect(p.mapError(new TypeError('x')).code).toBe('network');
    expect(p.mapError(new DOMException('x', 'AbortError')).code).toBe('aborted');
  });
});
