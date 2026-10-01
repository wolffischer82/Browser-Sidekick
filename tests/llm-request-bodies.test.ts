// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createProvider, DEFAULT_BASE_URLS, type LlmRequest } from '../src/shared/llm';
import type { ProviderKind } from '../src/shared/model';
import {
  collect,
  guardGlobalFetch,
  KEY,
  mockFetch,
  REQUEST,
  sseResponse,
} from './helpers/llm-fetch';

/**
 * The request bodies as they were before thinking levels (specs/thinking-levels.md,
 * T13): a request without thinking information must stay byte-identical, so
 * the bodies are compared as the exact strings sent, key order included.
 */

guardGlobalFetch();

const TURNS =
  '{"role":"user","content":"First question"},' +
  '{"role":"assistant","content":"First answer"},' +
  '{"role":"user","content":"Second question"}';
const GEMINI_CONTENTS =
  '{"role":"user","parts":[{"text":"First question"}]},' +
  '{"role":"model","parts":[{"text":"First answer"}]},' +
  '{"role":"user","parts":[{"text":"Second question"}]}';

/** What Test connection sends (spec 5.7 of the MVP spec). */
const ONE_TOKEN: LlmRequest = { ...REQUEST, system: '', maxOutputTokens: 1 };

interface Row {
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  request: LlmRequest;
  body: string;
}

const ROWS: Row[] = [
  {
    name: 'Anthropic, plain',
    kind: 'anthropic',
    request: REQUEST,
    body: `{"model":"test-model","max_tokens":4096,"system":"Answer from the pages.","messages":[${TURNS}],"stream":true}`,
  },
  {
    name: 'Anthropic, one token and no system text',
    kind: 'anthropic',
    request: ONE_TOKEN,
    body: `{"model":"test-model","max_tokens":1,"messages":[${TURNS}],"stream":true}`,
  },
  {
    name: 'Gemini, plain',
    kind: 'gemini',
    request: REQUEST,
    body: `{"contents":[${GEMINI_CONTENTS}],"systemInstruction":{"parts":[{"text":"Answer from the pages."}]}}`,
  },
  {
    name: 'Gemini, one token and no system text',
    kind: 'gemini',
    request: ONE_TOKEN,
    body: `{"contents":[${GEMINI_CONTENTS}],"generationConfig":{"maxOutputTokens":1}}`,
  },
  {
    name: 'OpenAI, plain',
    kind: 'openai-compatible',
    request: REQUEST,
    body: `{"model":"test-model","messages":[{"role":"system","content":"Answer from the pages."},${TURNS}],"stream":true}`,
  },
  {
    name: 'OpenAI, one token and no system text',
    kind: 'openai-compatible',
    request: ONE_TOKEN,
    body: `{"model":"test-model","messages":[${TURNS}],"stream":true,"max_completion_tokens":1}`,
  },
  {
    name: 'another OpenAI-compatible host, one token',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    request: ONE_TOKEN,
    body: `{"model":"test-model","messages":[${TURNS}],"stream":true,"max_tokens":1}`,
  },
];

describe('request bodies without thinking information', () => {
  it.each(ROWS)('$name: the body is byte-identical to before', async (row) => {
    const { fetch, calls } = mockFetch(() => sseResponse([]));
    const provider = createProvider(
      { kind: row.kind, baseUrl: row.baseUrl ?? DEFAULT_BASE_URLS[row.kind], apiKey: KEY },
      { fetch },
    );
    await collect(provider, row.request);
    expect(calls[0]?.init.body).toBe(row.body);
  });
});
