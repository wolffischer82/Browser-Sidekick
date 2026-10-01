import { LlmError, type LlmErrorCode } from './types';

/**
 * Maps HTTP failures, in-stream error payloads and thrown errors to
 * `LlmError` (spec 5.6 "Errors"). The provider's own text is kept only as
 * `providerMessage`, with the key redacted and the length capped.
 */

export const PROVIDER_MESSAGE_MAX = 300;

interface ErrorInfo {
  message: string | null;
  /** `type`, `code`, `status` and `details[].reason` fields, lower-cased. */
  tags: string;
  /** A numeric `code` inside the payload (OpenRouter, Gemini). */
  numericCode: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Reads the error fields every supported provider uses. */
function infoFromPayload(payload: unknown): ErrorInfo {
  if (typeof payload === 'string') return { message: payload, tags: '', numericCode: null };
  if (!isRecord(payload)) return { message: null, tags: '', numericCode: null };
  const tags: string[] = [];
  for (const key of ['type', 'code', 'status']) {
    const value = payload[key];
    if (typeof value === 'string') tags.push(value);
  }
  const details = payload.details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (isRecord(detail) && typeof detail.reason === 'string') tags.push(detail.reason);
    }
  }
  const code = payload.code;
  return {
    message: stringField(payload, 'message') ?? stringField(payload, 'detail'),
    tags: tags.join(' ').toLowerCase(),
    numericCode: typeof code === 'number' ? code : null,
  };
}

/** Finds the error object in a response body: `{ error: … }` or the body itself. */
function infoFromBody(body: unknown): ErrorInfo {
  if (isRecord(body) && body.error !== undefined) {
    const inner = infoFromPayload(body.error);
    const outer = infoFromPayload(body);
    return { ...inner, message: inner.message ?? outer.message };
  }
  return infoFromPayload(body);
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function sanitize(message: string | null, apiKey: string): string | null {
  if (message === null) return null;
  let text = message;
  if (apiKey.length > 0) text = text.split(apiKey).join('[key]');
  text = text.replace(/\s+/g, ' ').trim();
  if (text === '' || text.startsWith('<')) return null;
  if (text.length > PROVIDER_MESSAGE_MAX) text = `${text.slice(0, PROVIDER_MESSAGE_MAX - 1)}…`;
  return text;
}

const INVALID_KEY = /api_key_invalid|api key not valid|invalid[ _]api[ _]key|incorrect api key/;
const MODEL_NOT_FOUND =
  /model_not_found|no such model|model\b.{0,60}\b(not found|does not exist|doesn't exist|is not available)/;
const CONTEXT_TOO_LONG =
  /context_length_exceeded|context[ _]length|context window|maximum context|too long|too many tokens|exceeds the maximum|reduce the length|request_too_large/;

/** Classifies a 400-style failure by the provider's words. */
function classifyText(info: ErrorInfo): LlmErrorCode {
  const text = `${info.tags} ${info.message ?? ''}`.toLowerCase();
  if (INVALID_KEY.test(text)) return 'invalid-key';
  if (MODEL_NOT_FOUND.test(text)) return 'model-not-found';
  if (CONTEXT_TOO_LONG.test(text)) return 'context-too-long';
  return 'bad-request';
}

function classifyStatus(status: number, info: ErrorInfo): LlmErrorCode {
  if (status === 401 || status === 403) return 'invalid-key';
  if (status === 402 || status === 429) return 'rate-limit';
  if (status === 404) return 'model-not-found';
  if (status === 413) return 'context-too-long';
  if (status === 400 || status === 422) return classifyText(info);
  if (status === 408 || status >= 500) return 'server';
  if (status >= 400) return 'bad-request';
  return 'unknown';
}

/** What the provider's rejection of a thinking level mentions (specs/thinking-levels.md 4.6). */
const THINKING = /reasoning|thinking|effort/i;

export interface RequestFacts {
  /** The request body carried a thinking level. */
  thinkingLevel?: boolean;
}

/**
 * Maps a non-OK HTTP response (status and body text). A 400/422 that would
 * be a plain `bad-request` becomes `thinking-unsupported` when the request
 * carried a thinking level and the provider's message names it.
 */
export function errorFromResponse(
  status: number,
  bodyText: string,
  apiKey: string,
  request: RequestFacts = {},
): LlmError {
  const info = infoFromBody(parseBody(bodyText));
  let code = classifyStatus(status, info);
  if (
    request.thinkingLevel === true &&
    code === 'bad-request' &&
    (status === 400 || status === 422) &&
    THINKING.test(info.message ?? '')
  ) {
    code = 'thinking-unsupported';
  }
  return new LlmError(code, {
    status,
    providerMessage: sanitize(info.message, apiKey),
  });
}

const PAYLOAD_TYPES: Record<string, LlmErrorCode> = {
  authentication_error: 'invalid-key',
  permission_error: 'invalid-key',
  rate_limit_error: 'rate-limit',
  billing_error: 'rate-limit',
  not_found_error: 'model-not-found',
  request_too_large: 'context-too-long',
};

/**
 * Maps an error delivered inside a stream after a 200 response: Anthropic's
 * `error` event, an OpenAI-compatible `{ error }` chunk, or Gemini's error object.
 */
export function errorFromPayload(payload: unknown, apiKey: string): LlmError {
  const info = infoFromPayload(payload);
  let code: LlmErrorCode;
  const byType = Object.entries(PAYLOAD_TYPES).find(([type]) => info.tags.includes(type));
  if (byType) code = byType[1];
  else if (info.tags.includes('invalid_request_error')) code = classifyText(info);
  else if (info.numericCode !== null && info.numericCode >= 400)
    code = classifyStatus(info.numericCode, info);
  else code = 'server';
  return new LlmError(code, { providerMessage: sanitize(info.message, apiKey) });
}

/** Maps anything thrown by `fetch` or while reading the body. */
export function errorFromThrown(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (isRecord(error) && error.name === 'AbortError') return new LlmError('aborted');
  if (error instanceof TypeError) return new LlmError('network');
  return new LlmError('unknown');
}
