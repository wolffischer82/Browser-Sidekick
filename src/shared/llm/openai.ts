import { errorFromPayload, errorFromThrown } from './errors';
import {
  globalFetch,
  isRecord,
  listOrFallback,
  parseEventData,
  readJson,
  send,
  sseEvents,
  trimSlashes,
} from './http';
import type { FetchFn, LlmProvider, LlmRequest, ModelInfo } from './types';

/**
 * OpenAI-compatible adapter: OpenAI Chat Completions streaming and
 * `GET /models` (decisions.md T04). Also serves OpenRouter, Groq, Ollama,
 * LM Studio and gateways, so it is lenient: unknown fields and event
 * names are ignored, bare JSON lines are accepted, a missing `[DONE]` is
 * fine, a non-streamed JSON reply is accepted, and a missing or odd
 * `/models` falls back to free-text model entry.
 */

export interface OpenAiConfig {
  /** Includes the version path, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  /** May be empty for local servers; then no `Authorization` header is sent. */
  apiKey: string;
}

function isOfficialOpenAi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

/** `supported_parameters` entries that mean the model takes a reasoning level. */
const REASONING_PARAMETERS = ['reasoning', 'reasoning_effort'];

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createOpenAiProvider(
  config: OpenAiConfig,
  fetchFn: FetchFn = globalFetch,
): LlmProvider {
  const base = trimSlashes(config.baseUrl);
  const apiKey = config.apiKey;
  const auth: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  function buildBody(request: LlmRequest): Record<string, unknown> {
    const messages = [
      ...(request.system ? [{ role: 'system', content: request.system }] : []),
      ...request.turns.map((turn) => ({ role: turn.role, content: turn.content })),
    ];
    const body: Record<string, unknown> = { model: request.model, messages, stream: true };
    if (request.maxOutputTokens !== undefined) {
      // OpenAI deprecated `max_tokens` (not accepted by reasoning models);
      // other compatible servers still expect it.
      const key = isOfficialOpenAi(base) ? 'max_completion_tokens' : 'max_tokens';
      body[key] = request.maxOutputTokens;
    }
    return body;
  }

  async function* stream(request: LlmRequest, signal: AbortSignal): AsyncGenerator<string> {
    const response = await send(
      fetchFn,
      `${base}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(buildBody(request)),
      },
      apiKey,
      signal,
    );

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      // The server ignored `stream: true` and sent the whole completion.
      const json = await readJson(response, signal);
      if (isRecord(json) && json.error !== undefined) throw errorFromPayload(json.error, apiKey);
      const choice =
        isRecord(json) && Array.isArray(json.choices) ? (json.choices[0] as unknown) : undefined;
      const text =
        isRecord(choice) && isRecord(choice.message) ? textOf(choice.message.content) : '';
      if (text) yield text;
      return;
    }

    for await (const event of sseEvents(response, signal, { bareJsonLines: true })) {
      if (event.data.trim() === '[DONE]') return;
      const chunk = parseEventData(event.data);
      if (!chunk) continue;
      if (chunk.error !== undefined) throw errorFromPayload(chunk.error, apiKey);
      const choice = Array.isArray(chunk.choices) ? (chunk.choices[0] as unknown) : undefined;
      // Only visible content; `reasoning`, tool calls and usage are ignored.
      const text = isRecord(choice) && isRecord(choice.delta) ? textOf(choice.delta.content) : '';
      if (text) yield text;
    }
  }

  async function listModels(signal?: AbortSignal) {
    return listOrFallback(async () => {
      const response = await send(
        fetchFn,
        `${base}/models`,
        { method: 'GET', headers: { ...auth } },
        apiKey,
        signal,
      );
      const json = await readJson(response, signal);
      if (!isRecord(json)) return null;
      const list = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.models)
          ? json.models
          : null;
      if (!list) return null;
      const ids: string[] = [];
      const info = new Map<string, ModelInfo>();
      for (const item of list) {
        const id = isRecord(item) ? textOf(item.id) || textOf(item.name) : textOf(item);
        if (id === '' || ids.includes(id)) continue;
        ids.push(id);
        // OpenRouter lists what each model accepts; without the array the model is unknown.
        if (isRecord(item) && Array.isArray(item.supported_parameters)) {
          const accepts = REASONING_PARAMETERS.some((name) =>
            (item.supported_parameters as unknown[]).includes(name),
          );
          info.set(id, { thinking: accepts ? 'supported' : 'unsupported' });
        }
      }
      return { ids: ids.sort((a, b) => a.localeCompare(b)), info };
    }, signal);
  }

  return {
    kind: 'openai-compatible',
    listModels,
    stream,
    mapError: errorFromThrown,
  };
}
