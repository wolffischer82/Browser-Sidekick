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
import type { FetchFn, LlmProvider, LlmRequest, ModelInfo, ThinkingLevel } from './types';

/**
 * Google Gemini adapter: `models.streamGenerateContent?alt=sse` and
 * `models.list` on the v1beta REST API (decisions.md T04). The key goes in
 * the `x-goog-api-key` header, never in the URL.
 */

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const API = `${GEMINI_BASE_URL}/v1beta`;
/** Safety bound on model-list pagination. */
const MAX_PAGES = 10;

/** `thinkingBudget` per level, for the models that take a budget (`gemini-2.5`). */
export const GEMINI_BUDGET_TOKENS: Readonly<Record<ThinkingLevel, number>> = {
  low: 2048,
  medium: 8192,
  high: 24_576,
};

/**
 * `generationConfig.thinkingConfig` (specs/thinking-levels.md 4.3), or `null`
 * to send none. Never both `thinkingBudget` and `thinkingLevel`.
 */
function thinkingConfig(request: LlmRequest): Record<string, unknown> | null {
  if (!request.thinking) return null;
  const { level, info } = request.thinking;
  if (info?.thinking === 'unsupported') return null;
  if (level === null) return info?.thinking === 'supported' ? { includeThoughts: true } : null;
  return request.model.includes('gemini-2.5')
    ? { includeThoughts: true, thinkingBudget: GEMINI_BUDGET_TOKENS[level] }
    : { includeThoughts: true, thinkingLevel: level };
}

export interface GeminiConfig {
  apiKey: string;
}

/** Accepts `gemini-x` or `models/gemini-x`. */
function modelPath(model: string): string {
  const id = model.trim().replace(/^models\//, '');
  return `models/${encodeURIComponent(id)}`;
}

export function createGeminiProvider(
  config: GeminiConfig,
  fetchFn: FetchFn = globalFetch,
): LlmProvider {
  const apiKey = config.apiKey;
  const auth: Record<string, string> = apiKey ? { 'x-goog-api-key': apiKey } : {};

  function buildBody(
    request: LlmRequest,
    thinking: Record<string, unknown> | null,
  ): Record<string, unknown> {
    const generationConfig = {
      ...(request.maxOutputTokens !== undefined
        ? { maxOutputTokens: request.maxOutputTokens }
        : {}),
      ...(thinking ? { thinkingConfig: thinking } : {}),
    };
    return {
      contents: request.turns.map((turn) => ({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: turn.content }],
      })),
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    };
  }

  async function* stream(request: LlmRequest, signal: AbortSignal): AsyncGenerator<string> {
    const thinking = thinkingConfig(request);
    const response = await send(
      fetchFn,
      `${API}/${modelPath(request.model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(buildBody(request, thinking)),
      },
      apiKey,
      signal,
      { thinkingLevel: thinking !== null && request.thinking?.level != null },
    );
    for await (const event of sseEvents(response, signal)) {
      const data = parseEventData(event.data);
      if (!data) continue;
      if (data.error !== undefined) throw errorFromPayload(data.error, apiKey);
      const candidate = Array.isArray(data.candidates)
        ? (data.candidates[0] as unknown)
        : undefined;
      const content = isRecord(candidate) ? candidate.content : undefined;
      const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
      let text = '';
      for (const part of parts) {
        // Thought summaries are not part of the answer.
        if (isRecord(part) && part.thought !== true && typeof part.text === 'string') {
          text += part.text;
        }
      }
      if (text) yield text;
    }
  }

  async function listModels(signal?: AbortSignal) {
    return listOrFallback(async () => {
      const ids: string[] = [];
      const info = new Map<string, ModelInfo>();
      let pageToken: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ pageSize: '1000' });
        if (pageToken) query.set('pageToken', pageToken);
        const response = await send(
          fetchFn,
          `${API}/models?${query.toString()}`,
          { method: 'GET', headers: { ...auth } },
          apiKey,
          signal,
        );
        const json = await readJson(response, signal);
        if (!isRecord(json) || !Array.isArray(json.models)) return null;
        for (const item of json.models) {
          if (!isRecord(item) || typeof item.name !== 'string') continue;
          const methods = item.supportedGenerationMethods;
          // Only models that can answer chat requests.
          if (Array.isArray(methods) && !methods.includes('generateContent')) continue;
          const id = item.name.replace(/^models\//, '');
          ids.push(id);
          // A missing or non-boolean `thinking` leaves the model unknown.
          if (typeof item.thinking === 'boolean' && !info.has(id)) {
            info.set(id, { thinking: item.thinking ? 'supported' : 'unsupported' });
          }
        }
        pageToken = typeof json.nextPageToken === 'string' ? json.nextPageToken : null;
        if (!pageToken) break;
      }
      return { ids, info };
    }, signal);
  }

  return { kind: 'gemini', listModels, stream, mapError: errorFromThrown };
}
