import { afterEach, beforeEach, expect, vi } from 'vitest';
import type { FetchFn, LlmProvider, LlmRequest, LlmStreamEvent } from '../../src/shared/llm/types';
import { LlmError } from '../../src/shared/llm/types';

/**
 * Mocked `fetch` for the LLM adapter tests. Nothing here reaches the
 * network: `guardGlobalFetch` makes any call to the real global `fetch`
 * fail the test.
 */

export const KEY = 'sk-test-KEY-0123456789';

export function guardGlobalFetch(): void {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unmocked network call');
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
}

export interface Call {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
  body: unknown;
}

/** Records every call and answers with `respond`. */
export function mockFetch(respond: (call: Call) => Response | Promise<Response>): {
  fetch: FetchFn;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchFn = vi.fn<FetchFn>((url, init) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    const call = { url, init, headers, body };
    calls.push(call);
    return Promise.resolve(respond(call));
  });
  return { fetch: fetchFn, calls };
}

const encoder = new TextEncoder();

/** A streamed response delivering `chunks` as separate reads. */
export function sseResponse(chunks: string[], contentType = 'text/event-stream'): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': contentType } });
}

/** Splits `text` into chunks of `size` characters, cutting through events. */
export function splitEvery(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

/** A streamed response the test feeds by hand; the body ignores aborts. */
export function controlledResponse(): {
  response: Response;
  push: (text: string) => void;
  close: () => void;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
    push: (text) => {
      controller.enqueue(encoder.encode(text));
    },
    close: () => {
      controller.close();
    },
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const REQUEST: LlmRequest = {
  model: 'test-model',
  system: 'Answer from the pages.',
  turns: [
    { role: 'user', content: 'First question' },
    { role: 'assistant', content: 'First answer' },
    { role: 'user', content: 'Second question' },
  ],
};

/** Collects all events, text and reasoning; on failure returns them with the error. */
export async function collectEvents(
  provider: LlmProvider,
  request: LlmRequest = REQUEST,
  signal: AbortSignal = new AbortController().signal,
): Promise<{ events: LlmStreamEvent[]; error: LlmError | null }> {
  const events: LlmStreamEvent[] = [];
  try {
    for await (const event of provider.stream(request, signal)) events.push(event);
    return { events, error: null };
  } catch (error) {
    expect(error).toBeInstanceOf(LlmError);
    return { events, error: error as LlmError };
  }
}

/** Collects the text deltas (the answer); on failure returns them with the error. */
export async function collect(
  provider: LlmProvider,
  request: LlmRequest = REQUEST,
  signal: AbortSignal = new AbortController().signal,
): Promise<{ deltas: string[]; error: LlmError | null }> {
  const { events, error } = await collectEvents(provider, request, signal);
  return { deltas: events.filter((e) => e.type === 'text').map((e) => e.delta), error };
}

/** Shorthands for expected events. */
export const text = (delta: string): LlmStreamEvent => ({ type: 'text', delta });
export const reasoning = (delta: string): LlmStreamEvent => ({ type: 'reasoning', delta });

/** Joins neighbouring events of the same type, so a test holds for any chunking. */
export function merged(events: readonly LlmStreamEvent[]): LlmStreamEvent[] {
  const out: LlmStreamEvent[] = [];
  for (const event of events) {
    const last = out.at(-1);
    if (last?.type === event.type) last.delta += event.delta;
    else out.push({ ...event });
  }
  return out;
}

/** Asserts the key appears only in `header` of every call. */
export function expectKeyOnlyIn(calls: Call[], header: string): void {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call.url).not.toContain(KEY);
    expect(JSON.stringify(call.body)).not.toContain(KEY);
    for (const [name, value] of Object.entries(call.headers)) {
      if (name === header) expect(value).toContain(KEY);
      else expect(value).not.toContain(KEY);
    }
    expect(call.headers[header]).toBeDefined();
  }
}
