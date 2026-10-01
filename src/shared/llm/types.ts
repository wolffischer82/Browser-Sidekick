import type { ModelInfo, ProviderKind, ThinkingLevel } from '../model';

export type { ModelInfo, ThinkingLevel };

/**
 * LLM layer (spec 6 "LLM layer", 5.6, 5.7). One adapter per provider kind
 * implements `LlmProvider`. Adapters build requests, parse the provider's
 * stream into text deltas and map failures to `LlmError`. They never log.
 */

/** One chat turn sent to the model. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  model: string;
  /** System instructions (spec 5.6 step 1). Omitted when empty. */
  system: string;
  /** History and the new question, oldest first. */
  turns: ChatTurn[];
  /**
   * Upper bound for the answer's tokens. Test connection uses 1 (spec 5.7).
   * When omitted, OpenAI-compatible and Gemini use the server default and
   * Anthropic, where it's required, uses `ANTHROPIC_DEFAULT_MAX_TOKENS`.
   */
  maxOutputTokens?: number;
  /**
   * Thinking information (specs/thinking-levels.md 4.3). Absent for Test
   * connection and title generation: the adapter then builds the body it
   * built before thinking levels existed. `level: null` is Default;
   * `info: undefined` means the model's support is unknown.
   */
  thinking?: { level: ThinkingLevel | null; info: ModelInfo | undefined };
}

/** Why a request failed. The UI localises the code (T05, T10). */
export type LlmErrorCode =
  /** 401/403, or a provider's "API key not valid" 400. */
  | 'invalid-key'
  /** 429, or 402 quota/billing. */
  | 'rate-limit'
  /** 404, or a provider's "model not found" 400. */
  | 'model-not-found'
  /** The provider's 400/413 saying the input is too long. */
  | 'context-too-long'
  /**
   * A 400/422 that names reasoning, thinking or effort, on a request that
   * sent a thinking level (specs/thinking-levels.md 4.6).
   */
  | 'thinking-unsupported'
  /** Any other 4xx; `providerMessage` carries the provider's text. */
  | 'bad-request'
  /** 5xx, 529 overloaded, or an error event inside the stream. */
  | 'server'
  /** Fetch failed (offline, DNS, CORS, missing host access) or the stream broke. */
  | 'network'
  /** The caller aborted the request (Stop). */
  | 'aborted'
  /** Anything else, e.g. an unreadable reply. */
  | 'unknown';

/**
 * A mapped failure. `message` is static (`LLM request failed: <code>`), so it
 * is safe to log. `providerMessage` is the provider's own error text, with
 * the API key redacted and capped at `PROVIDER_MESSAGE_MAX` characters; the
 * UI may show it for `context-too-long` and `bad-request` (spec 5.6).
 */
export class LlmError extends Error {
  override readonly name = 'LlmError';
  readonly code: LlmErrorCode;
  readonly status: number | null;
  readonly providerMessage: string | null;

  constructor(
    code: LlmErrorCode,
    options: { status?: number | null; providerMessage?: string | null } = {},
  ) {
    super(`LLM request failed: ${code}`);
    this.code = code;
    this.status = options.status ?? null;
    this.providerMessage = options.providerMessage ?? null;
  }
}

/**
 * Result of `listModels`. `models: null` means listing failed or isn't
 * supported, and the settings form falls back to free-text entry (spec 5.7).
 * `info` holds what the list says about each model, keyed by model id; a
 * model without an entry is unknown (specs/thinking-levels.md 4.2).
 */
export type ModelList =
  { models: string[]; info: Record<string, ModelInfo> } | { models: null; error: LlmError };

export interface LlmProvider {
  readonly kind: ProviderKind;
  /**
   * Lists the provider's chat models. Never rejects except with an
   * `aborted` `LlmError` when `signal` aborts.
   */
  listModels(signal?: AbortSignal): Promise<ModelList>;
  /**
   * Streams the answer as text deltas. Rejects with an `LlmError`; on abort
   * the code is `aborted` and the deltas already yielded are the partial answer.
   */
  stream(request: LlmRequest, signal: AbortSignal): AsyncIterable<string>;
  /** Maps anything thrown around a request to an `LlmError`. */
  mapError(error: unknown): LlmError;
}

/** The subset of `fetch` the adapters use; injectable for tests. */
export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;
