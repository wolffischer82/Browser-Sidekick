import { t, type MessageKey } from './i18n';
import type { LlmError, LlmErrorCode } from './llm';

/**
 * Plain, localised text for an `LlmError` (spec 5.6 "Errors"). Used by
 * Test connection (T05) and the ask flow (T10). The key and page content
 * never appear: the text is static, and the provider's own message is
 * already redacted and capped by the adapter (decisions.md T04-3).
 */

const KEYS: Record<LlmErrorCode, MessageKey> = {
  'invalid-key': 'llmErrorInvalidKey',
  'rate-limit': 'llmErrorRateLimit',
  'model-not-found': 'llmErrorModelNotFound',
  'context-too-long': 'llmErrorContextTooLong',
  // Its own text, without the provider's (specs/thinking-levels.md 4.6).
  'thinking-unsupported': 'llmErrorThinkingUnsupported',
  'bad-request': 'llmErrorBadRequest',
  server: 'llmErrorServer',
  network: 'llmErrorNetwork',
  aborted: 'llmErrorAborted',
  unknown: 'llmErrorUnknown',
};

/** Codes whose provider message helps the user (spec 5.6: "the provider's 400 message"). */
const SHOW_PROVIDER_MESSAGE: ReadonlySet<LlmErrorCode> = new Set([
  'context-too-long',
  'bad-request',
]);

export interface LlmErrorText {
  message: string;
  /** "Provider message: …", or `null` when there is none or it isn't useful. */
  detail: string | null;
}

export function llmErrorText(error: LlmError): LlmErrorText {
  const detail =
    SHOW_PROVIDER_MESSAGE.has(error.code) && error.providerMessage
      ? t('providerMessage', error.providerMessage)
      : null;
  return { message: t(KEYS[error.code]), detail };
}
