import { errorFromResponse, errorFromThrown } from './errors';
import { readSseEvents, type SseEvent, type SseOptions } from './sse';
import { LlmError, type FetchFn } from './types';

/**
 * Request helpers shared by the adapters. Every failure leaves here as an
 * `LlmError`; an abort always becomes `aborted`, whatever the signal's reason.
 */

/** Uses the global `fetch` at call time, so tests can stub it. */
export const globalFetch: FetchFn = (input, init) => globalThis.fetch(input, init);

function mapAbortAware(error: unknown, signal: AbortSignal | undefined): LlmError {
  if (signal?.aborted) return new LlmError('aborted');
  return errorFromThrown(error);
}

async function readText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** Sends the request and returns the OK response, or throws the mapped error. */
export async function send(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  apiKey: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
  if (signal?.aborted) throw new LlmError('aborted');
  let response: Response;
  try {
    response = await fetchFn(url, signal ? { ...init, signal } : init);
  } catch (error) {
    throw mapAbortAware(error, signal);
  }
  if (!response.ok) {
    const body = await readText(response);
    if (signal?.aborted) throw new LlmError('aborted');
    throw errorFromResponse(response.status, body, apiKey);
  }
  return response;
}

/** Reads a JSON body; `null` when it isn't JSON. */
export async function readJson(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw mapAbortAware(error, signal);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Iterates the SSE events of a streamed response until it ends or aborts. */
export async function* sseEvents(
  response: Response,
  signal: AbortSignal,
  options: Omit<SseOptions, 'signal'> = {},
): AsyncGenerator<SseEvent> {
  if (!response.body) throw new LlmError('unknown');
  try {
    for await (const event of readSseEvents(response.body, { ...options, signal })) {
      if (signal.aborted) throw new LlmError('aborted');
      yield event;
    }
  } catch (error) {
    throw mapAbortAware(error, signal);
  }
  if (signal.aborted) throw new LlmError('aborted');
}

/** Parses an event's JSON data; `null` for anything that isn't a JSON object. */
export function parseEventData(data: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(data) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Runs `list`, turning every failure except an abort into the free-text fallback. */
export async function listOrFallback(
  list: () => Promise<string[] | null>,
  signal: AbortSignal | undefined,
): Promise<{ models: string[] } | { models: null; error: LlmError }> {
  try {
    const models = await list();
    // An empty or unreadable list also falls back to free-text entry.
    return models && models.length > 0
      ? { models }
      : { models: null, error: new LlmError('unknown') };
  } catch (error) {
    const mapped = mapAbortAware(error, signal);
    if (mapped.code === 'aborted') throw mapped;
    return { models: null, error: mapped };
  }
}

export function trimSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
