import type { ProviderConfig, ProviderKind } from '../model';
import { ANTHROPIC_BASE_URL, createAnthropicProvider } from './anthropic';
import { createGeminiProvider, GEMINI_BASE_URL } from './gemini';
import { globalFetch } from './http';
import { createOpenAiProvider } from './openai';
import type { FetchFn, LlmProvider } from './types';

export * from './types';

/**
 * Base URL prefilled per kind (spec 5.7). Only OpenAI-compatible uses the
 * stored base URL; Anthropic and Gemini always call their own host, so their
 * keys can only go to that provider (D5).
 */
export const DEFAULT_BASE_URLS: Readonly<Record<ProviderKind, string>> = {
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: ANTHROPIC_BASE_URL,
  gemini: GEMINI_BASE_URL,
};

/** Creates the adapter for a saved provider. `fetch` is injectable for tests. */
export function createProvider(
  config: Pick<ProviderConfig, 'kind' | 'baseUrl' | 'apiKey'>,
  options: { fetch?: FetchFn } = {},
): LlmProvider {
  const fetchFn = options.fetch ?? globalFetch;
  switch (config.kind) {
    case 'openai-compatible':
      return createOpenAiProvider({ baseUrl: config.baseUrl, apiKey: config.apiKey }, fetchFn);
    case 'anthropic':
      return createAnthropicProvider({ apiKey: config.apiKey }, fetchFn);
    case 'gemini':
      return createGeminiProvider({ apiKey: config.apiKey }, fetchFn);
  }
}
