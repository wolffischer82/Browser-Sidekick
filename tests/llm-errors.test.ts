import { describe, expect, it } from 'vitest';
import {
  errorFromPayload,
  errorFromResponse,
  errorFromThrown,
  PROVIDER_MESSAGE_MAX,
} from '../src/shared/llm/errors';
import { LlmError } from '../src/shared/llm/types';

const KEY = 'sk-secret-key-1234';

describe('errorFromResponse', () => {
  it.each([
    [401, 'invalid-key'],
    [403, 'invalid-key'],
    [402, 'rate-limit'],
    [429, 'rate-limit'],
    [404, 'model-not-found'],
    [413, 'context-too-long'],
    [408, 'server'],
    [500, 'server'],
    [503, 'server'],
    [529, 'server'],
    [409, 'bad-request'],
    [302, 'unknown'],
  ] as const)('maps status %i to %s', (status, code) => {
    const error = errorFromResponse(status, '', KEY);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  });

  it('classifies 400 bodies from each provider', () => {
    const openAiContext = JSON.stringify({
      error: {
        message: "This model's maximum context length is 128000 tokens.",
        type: 'invalid_request_error',
        code: 'context_length_exceeded',
      },
    });
    const anthropicContext = JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'prompt is too long: 210000 tokens > 200000 maximum',
      },
    });
    const geminiKey = JSON.stringify({
      error: {
        code: 400,
        message: 'API key not valid. Please pass a valid API key.',
        status: 'INVALID_ARGUMENT',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' },
        ],
      },
    });
    const geminiContext = JSON.stringify({
      error: {
        code: 400,
        message:
          'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).',
        status: 'INVALID_ARGUMENT',
      },
    });
    const openAiModel = JSON.stringify({
      error: { message: 'The model `gpt-9` does not exist', code: 'model_not_found' },
    });
    const ollamaModel = JSON.stringify({ error: "model 'llama9' not found" });
    const other = JSON.stringify({ error: { message: 'temperature must be at most 2' } });

    expect(errorFromResponse(400, openAiContext, KEY).code).toBe('context-too-long');
    expect(errorFromResponse(400, anthropicContext, KEY).code).toBe('context-too-long');
    expect(errorFromResponse(400, geminiKey, KEY).code).toBe('invalid-key');
    expect(errorFromResponse(400, geminiContext, KEY).code).toBe('context-too-long');
    expect(errorFromResponse(400, openAiModel, KEY).code).toBe('model-not-found');
    expect(errorFromResponse(400, ollamaModel, KEY).code).toBe('model-not-found');
    const bad = errorFromResponse(400, other, KEY);
    expect(bad.code).toBe('bad-request');
    expect(bad.providerMessage).toBe('temperature must be at most 2');
  });

  it('keeps the provider message of a 400 as providerMessage', () => {
    const body = JSON.stringify({ error: { message: 'prompt is too long' } });
    expect(errorFromResponse(400, body, KEY).providerMessage).toBe('prompt is too long');
  });

  it('reads `detail` and top-level `message` bodies and plain text', () => {
    expect(errorFromResponse(400, '{"detail":"context window exceeded"}', KEY)).toMatchObject({
      code: 'context-too-long',
      providerMessage: 'context window exceeded',
    });
    expect(errorFromResponse(400, '{"message":"bad thing"}', KEY).providerMessage).toBe(
      'bad thing',
    );
    expect(errorFromResponse(400, 'plain  text\nreply', KEY).providerMessage).toBe(
      'plain text reply',
    );
  });

  it('drops HTML bodies', () => {
    expect(errorFromResponse(400, '<html><body>Bad</body></html>', KEY).providerMessage).toBeNull();
  });

  it('redacts the key and caps the provider message', () => {
    const body = JSON.stringify({ error: { message: `Key ${KEY} rejected. ${'x'.repeat(1000)}` } });
    const error = errorFromResponse(400, body, KEY);
    expect(error.providerMessage).not.toContain(KEY);
    expect(error.providerMessage).toContain('[key]');
    expect(error.providerMessage?.length).toBeLessThanOrEqual(PROVIDER_MESSAGE_MAX);
  });

  it('never puts provider text into Error.message', () => {
    const body = JSON.stringify({ error: { message: 'secret page text' } });
    expect(errorFromResponse(400, body, KEY).message).toBe('LLM request failed: bad-request');
  });
});

describe('errorFromPayload', () => {
  it.each([
    [{ type: 'overloaded_error', message: 'Overloaded' }, 'server'],
    [{ type: 'api_error', message: 'Internal' }, 'server'],
    [{ type: 'rate_limit_error', message: 'Slow down' }, 'rate-limit'],
    [{ type: 'authentication_error', message: 'bad key' }, 'invalid-key'],
    [{ type: 'not_found_error', message: 'model: x' }, 'model-not-found'],
    [{ type: 'invalid_request_error', message: 'prompt is too long' }, 'context-too-long'],
    [{ code: 429, message: 'Rate limited by upstream' }, 'rate-limit'],
    [{ code: 502, message: 'Provider returned error' }, 'server'],
    [{ message: 'something odd' }, 'server'],
    ['plain string error', 'server'],
  ] as const)('maps %j to %s', (payload, code) => {
    expect(errorFromPayload(payload, KEY).code).toBe(code);
  });
});

describe('errorFromThrown', () => {
  it('passes LlmError through', () => {
    const error = new LlmError('rate-limit');
    expect(errorFromThrown(error)).toBe(error);
  });

  it('maps AbortError to aborted', () => {
    expect(errorFromThrown(new DOMException('x', 'AbortError')).code).toBe('aborted');
  });

  it('maps TypeError (failed fetch, CORS) to network', () => {
    expect(errorFromThrown(new TypeError('Failed to fetch')).code).toBe('network');
  });

  it('maps anything else to unknown without keeping its text', () => {
    const error = errorFromThrown(new Error(`boom ${KEY}`));
    expect(error.code).toBe('unknown');
    expect(error.providerMessage).toBeNull();
    expect(error.message).not.toContain(KEY);
  });
});
