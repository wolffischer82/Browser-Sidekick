import { errorFromPayload, errorFromThrown } from './errors';
import {
  globalFetch,
  isRecord,
  listOrFallback,
  parseEventData,
  readJson,
  send,
  sseEvents,
} from './http';
import type { FetchFn, LlmProvider, LlmRequest, ModelInfo } from './types';

/**
 * Anthropic adapter: Messages API streaming and `GET /v1/models`
 * (decisions.md T04). Unknown event types and delta types (thinking,
 * signatures, tool input) are ignored, as the API's versioning policy asks.
 */

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';
/** `max_tokens` is required; used when the request sets no limit. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;
/** Safety bound on model-list pagination. */
const MAX_PAGES = 10;

export interface AnthropicConfig {
  apiKey: string;
}

function isSupported(value: unknown): boolean {
  return isRecord(value) && value.supported === true;
}

/**
 * Reads a model object's thinking support (specs/thinking-levels.md 4.2).
 * `null` is unknown: the object has no `capabilities`, or they say nothing
 * readable about thinking.
 */
function modelInfoOf(model: Record<string, unknown>): ModelInfo | null {
  const capabilities = model.capabilities;
  if (!isRecord(capabilities) || !isRecord(capabilities.thinking)) return null;
  const types = isRecord(capabilities.thinking.types) ? capabilities.thinking.types : {};
  const cap = model.max_tokens;
  const maxOutputTokens =
    typeof cap === 'number' && Number.isInteger(cap) && cap > 0 ? { maxOutputTokens: cap } : {};
  if (isSupported(capabilities.effort) && isSupported(types.adaptive)) {
    return { thinking: 'supported', thinkingMode: 'effort', ...maxOutputTokens };
  }
  if (isSupported(types.enabled)) {
    return { thinking: 'supported', thinkingMode: 'budget', ...maxOutputTokens };
  }
  return { thinking: 'unsupported', ...maxOutputTokens };
}

export function createAnthropicProvider(
  config: AnthropicConfig,
  fetchFn: FetchFn = globalFetch,
): LlmProvider {
  const apiKey = config.apiKey;
  const headers: Record<string, string> = {
    'anthropic-version': ANTHROPIC_VERSION,
    // Required for calls from a browser context (spec 6 "LLM layer").
    'anthropic-dangerous-direct-browser-access': 'true',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };

  function buildBody(request: LlmRequest): Record<string, unknown> {
    return {
      model: request.model,
      max_tokens: request.maxOutputTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
      ...(request.system ? { system: request.system } : {}),
      messages: request.turns.map((turn) => ({ role: turn.role, content: turn.content })),
      stream: true,
    };
  }

  async function* stream(request: LlmRequest, signal: AbortSignal): AsyncGenerator<string> {
    const response = await send(
      fetchFn,
      `${ANTHROPIC_BASE_URL}/v1/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(buildBody(request)),
      },
      apiKey,
      signal,
    );
    for await (const event of sseEvents(response, signal)) {
      const data = parseEventData(event.data);
      if (!data) continue;
      const type = data.type ?? event.event;
      if (type === 'error') throw errorFromPayload(data.error ?? data, apiKey);
      if (type === 'message_stop') return;
      if (
        type === 'content_block_delta' &&
        isRecord(data.delta) &&
        data.delta.type === 'text_delta' &&
        typeof data.delta.text === 'string' &&
        data.delta.text !== ''
      ) {
        yield data.delta.text;
      }
    }
  }

  async function listModels(signal?: AbortSignal) {
    return listOrFallback(async () => {
      const ids: string[] = [];
      const info = new Map<string, ModelInfo>();
      let afterId: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ limit: '1000' });
        if (afterId) query.set('after_id', afterId);
        const response = await send(
          fetchFn,
          `${ANTHROPIC_BASE_URL}/v1/models?${query.toString()}`,
          { method: 'GET', headers },
          apiKey,
          signal,
        );
        const json = await readJson(response, signal);
        if (!isRecord(json) || !Array.isArray(json.data)) return null;
        for (const item of json.data) {
          if (!isRecord(item) || typeof item.id !== 'string') continue;
          ids.push(item.id);
          const entry = modelInfoOf(item);
          if (entry && !info.has(item.id)) info.set(item.id, entry);
        }
        afterId = typeof json.last_id === 'string' ? json.last_id : null;
        if (json.has_more !== true || !afterId) break;
      }
      // Newest first, as the API returns them.
      return { ids, info };
    }, signal);
  }

  return { kind: 'anthropic', listModels, stream, mapError: errorFromThrown };
}
